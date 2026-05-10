import { cleanWord, findBestMatch } from './matching.mjs';

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let words            = [];
let currentIdx       = 0;
let micActive        = false;
let panelVisible     = true;
let autoScrollEnabled = true;

let worker           = null;
let audioContext     = null;
let mediaStream      = null;
let mediaRecorder    = null;
let audioChunks      = [];
let workerReady      = false;
let processingAudio  = false;
let currentLanguage  = 'english';
let currentDeviceId  = null;   // selected microphone deviceId (null = system default)
let currentGain      = 1.0;    // microphone gain multiplier
let gainNode         = null;   // live-adjustable GainNode in the recording graph
let processedStream  = null;   // output of the gain graph, fed to MediaRecorder
let audioTail        = null;   // tail of previous chunk, prefixed to next chunk for continuity
let pendingPayload   = null;   // most recent chunk waiting while the worker is still busy
let pendingNotice    = '';

const CHUNK_MS       = 2000;   // record a chunk every CHUNK_MS seconds
const SAMPLE_RATE    = 16000;
const OVERLAP_MS     = 1000;   // tail of previous chunk replayed at the start of the next
const OVERLAP_SAMPLES = (SAMPLE_RATE * OVERLAP_MS) / 1000;

function setSessionNotice(message, tone = '') {
	const notice = document.getElementById('sessionNotice');
	notice.textContent = message;
	notice.className = 'app-notice session-notice';
	if (tone) notice.classList.add(`is-${tone}`);
}

function clearSessionNotice() {
	setSessionNotice('');
}

// ─────────────────────────────────────────────
//  BUILD WORD SPANS
// ─────────────────────────────────────────────

/**
 * Splits text into word spans and populates the `words` array.
 * Must be called before initWorker().
 * @param {string} text - Raw text from the setup textarea
 */
function buildPrompter(text) {
	const container = document.getElementById('promptText');
	container.innerHTML = '';
	words = [];
	currentIdx = 0;
	const scrollContainer = document.getElementById('scrollContainer');
	if (scrollContainer) scrollContainer.scrollTop = 0;

	text.split(/(\s+)/).forEach(token => {
		if (/^\s+$/.test(token)) {
			container.appendChild(document.createTextNode(token));
		} else {
			const span = document.createElement('span');
			span.className = 'word';
			span.textContent = token;
			container.appendChild(span);
			words.push({ text: token, clean: cleanWord(token), el: span });
		}
	});
}

// ─────────────────────────────────────────────
//  SCROLL & HIGHLIGHT
// ─────────────────────────────────────────────
const MAX_SCROLL_SPEED = 3;
let scrollRafId = null;

function scrollToWord(idx) {
	if (idx < 0 || idx >= words.length) return;
	const el        = words[idx].el;
	const container = document.getElementById('scrollContainer');
	const elTop     = el.offsetTop + el.closest('#textPad').offsetTop;
	const target    = elTop - container.clientHeight * 0.28 + el.offsetHeight / 2;

	if (scrollRafId) cancelAnimationFrame(scrollRafId);

	function step() {
		const current = container.scrollTop;
		const diff    = target - current;
		if (Math.abs(diff) < 1) return;
		const move = Math.sign(diff) * Math.min(Math.abs(diff), MAX_SCROLL_SPEED);
		container.scrollTop += move;
		scrollRafId = requestAnimationFrame(step);
	}
	scrollRafId = requestAnimationFrame(step);
}

function updateHighlight(idx) {
	for (let i = 0; i < idx; i++)           words[i].el.className = 'word passed';
	if (words[idx])                          words[idx].el.className = 'word active';
	for (let i = idx + 1; i < words.length; i++) words[i].el.className = 'word';
}

// ─────────────────────────────────────────────
//  MATCH TRANSCRIPT → WORD POSITION
// ─────────────────────────────────────────────

function handleTranscript(text) {
	document.getElementById('transcript').textContent = '📝 ' + text.slice(-80);
	const spokenWords = text.trim().split(/\s+/).filter(Boolean);
	const scriptWords = words.map(word => word.clean);
	const matched = findBestMatch(scriptWords, currentIdx, spokenWords);
	if (matched !== -1 && matched >= currentIdx) {
		clearSessionNotice();
		currentIdx = matched;
		updateHighlight(currentIdx);
		if (autoScrollEnabled) scrollToWord(currentIdx);
	} else if (spokenWords.length >= 2) {
		setSessionNotice('Listening, but no reliable match yet.', 'warning');
	}
}

function queuePayload(payload) {
	pendingPayload = payload;
	if (pendingNotice !== 'queued') {
		setSessionNotice('Transcription is catching up. Keeping the latest audio chunk queued.', 'warning');
		pendingNotice = 'queued';
	}
}

function flushPendingPayload() {
	if (!pendingPayload || !workerReady || processingAudio || !worker) return;

	const nextPayload = pendingPayload;
	pendingPayload = null;
	pendingNotice = '';
	processingAudio = true;
	worker.postMessage(
		{ type: 'transcribe', audio: nextPayload, language: currentLanguage },
		[nextPayload.buffer],
	);
}

function submitPayload(payload) {
	if (!workerReady || !worker) return;
	if (processingAudio) {
		queuePayload(payload);
		return;
	}

	processingAudio = true;
	worker.postMessage({ type: 'transcribe', audio: payload, language: currentLanguage }, [payload.buffer]);
}

async function decodeAudioChunk(savedChunks, savedMime) {
	const blob        = new Blob(savedChunks, { type: savedMime });
	const arrayBuffer = await blob.arrayBuffer();
	const decoded     = await audioContext.decodeAudioData(arrayBuffer);
	const float32     = decoded.getChannelData(0);

	let payload;
	if (audioTail && audioTail.length) {
		payload = new Float32Array(audioTail.length + float32.length);
		payload.set(audioTail, 0);
		payload.set(float32, audioTail.length);
	} else {
		payload = new Float32Array(float32);
	}

	const tailSize = Math.min(OVERLAP_SAMPLES, float32.length);
	audioTail = float32.slice(float32.length - tailSize);
	return payload;
}

// ─────────────────────────────────────────────
//  WHISPER WORKER
// ─────────────────────────────────────────────
async function initWorker(language = 'english', deviceId = null, gain = 1.0) {
	currentLanguage = language;
	currentDeviceId = deviceId;
	currentGain     = gain;
	worker = new Worker('/whisper-worker.js', { type: 'module' });

	worker.onmessage = async ({ data }) => {
		if (data.type === 'status') {
			document.getElementById('loadingMsg').textContent = data.text;
		} else if (data.type === 'ready') {
			workerReady = true;
			document.getElementById('loadingOverlay').style.display = 'none';
			document.getElementById('prompter').style.display       = 'block';
			await startMic();
		} else if (data.type === 'transcript') {
			processingAudio = false;
			if (data.text) handleTranscript(data.text);
			flushPendingPayload();
		} else if (data.type === 'error') {
			processingAudio = false;
			setSessionNotice(`Transcription error: ${data.text}`, 'error');
			console.error('Worker error:', data.text);
			flushPendingPayload();
		}
	};

	worker.postMessage({ type: 'load' });
}

// ─────────────────────────────────────────────
//  MICROPHONE + MEDIARECORDER
// ─────────────────────────────────────────────
async function startMic() {
	try {
		const audioConstraints = currentDeviceId
			? { deviceId: { exact: currentDeviceId } }
			: true;
		mediaStream  = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
		audioContext = new AudioContext({ sampleRate: 16000 });

		const source = audioContext.createMediaStreamSource(mediaStream);
		gainNode     = audioContext.createGain();
		gainNode.gain.value = currentGain;
		const dest   = audioContext.createMediaStreamDestination();
		source.connect(gainNode);
		gainNode.connect(dest);
		processedStream = dest.stream;

		beginRecording();
		setMicUI(true);
		clearSessionNotice();
	} catch (err) {
		setSessionNotice(`Microphone access denied: ${err.message}`, 'error');
	}
}

function beginRecording() {
	audioChunks  = [];
	mediaRecorder = new MediaRecorder(processedStream || mediaStream);

	mediaRecorder.ondataavailable = (e) => {
		if (e.data.size > 0) audioChunks.push(e.data);
	};

	mediaRecorder.onstop = async () => {
		const savedChunks = audioChunks;
		const savedMime   = mediaRecorder.mimeType;
		if (micActive) beginRecording();

		if (!workerReady || !savedChunks.length) return;

		try {
			const payload = await decodeAudioChunk(savedChunks, savedMime);
			submitPayload(payload);
		} catch (e) {
			setSessionNotice('Audio chunk could not be decoded.', 'error');
			console.warn('Audio decode error:', e);
		}
	};

	mediaRecorder.start();
	setTimeout(() => {
		if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
	}, CHUNK_MS);
}

function stopMic() {
	if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
	micActive = false;
	setMicUI(false);
	if (pendingNotice === 'queued') clearSessionNotice();
}

function setMicUI(active) {
	micActive = active;
	const btn = document.getElementById('micBtn');
	const dot = document.getElementById('statusDot');
	if (active) {
		btn.classList.add('active-mic');
		btn.textContent   = '⏸';
		dot.className     = 'listening';
	} else {
		btn.classList.remove('active-mic');
		btn.textContent   = '🎙';
		dot.className     = '';
	}
}



// ─────────────────────────────────────────────
//  ENCAPSULATION FROM main.js TO AVOID DIRECT MUTATIONS
// ─────────────────────────────────────────────
function resetPrompter() {
	currentIdx = 0;
	autoScrollEnabled = true;
	pendingPayload = null;
	pendingNotice = '';
	if (scrollRafId) {
		cancelAnimationFrame(scrollRafId);
		scrollRafId = null;
	}
	updateHighlight(0);
	document.getElementById('transcript').textContent = '';
	clearSessionNotice();
	document.getElementById('scrollContainer').scrollTo({ top: 0, behavior: 'smooth' });
}

function exitPrompter() {
	stopMic();
	if (mediaStream)  { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
	if (worker)       { worker.terminate(); worker = null; workerReady = false; }
	if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
	mediaRecorder   = null;
	audioChunks     = [];
	processingAudio = false;
	audioTail       = null;
	pendingPayload  = null;
	pendingNotice   = '';
	gainNode        = null;
	processedStream = null;
	autoScrollEnabled = true;
	panelVisible = true;
	if (scrollRafId) {
		cancelAnimationFrame(scrollRafId);
		scrollRafId = null;
	}
	document.getElementById('prompter').style.display = 'none';
	document.getElementById('setup').style.display    = 'flex';
	document.getElementById('panel').classList.remove('hidden');
	document.getElementById('hideHint').textContent = 'Hide panel [H]';
	document.getElementById('transcript').textContent = '';
	clearSessionNotice();
	currentIdx = 0;
	words = [];
}

function resumeMic() {
	micActive = true;
	beginRecording();
	setMicUI(true);
}

function toggleAutoScroll(enabled) {
	autoScrollEnabled = enabled;
}

function setGain(value) {
	currentGain = value;
	if (gainNode) gainNode.gain.value = value;
}

function togglePanelVisibility() {
	panelVisible = !panelVisible;
	return panelVisible;
}

function toggleMic() {
	if (!workerReady) return;
	if (micActive) {
	stopMic();
	} else {
		if (!mediaStream) {
			startMic();
		} else {
			resumeMic();
		}
	}
}

// ─────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────
export {
	buildPrompter,
	initWorker,
	toggleMic,
	toggleAutoScroll,
	togglePanelVisibility,
	setGain,
	resetPrompter  as  reset,
	exitPrompter   as  exit,
};
