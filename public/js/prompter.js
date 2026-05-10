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
function cleanWord(w) {
	return w.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^\p{L}\p{N}']/gu, '');
}

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

function levenshteinDistance(a, b) {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

	for (let i = 0; i < rows; i++) dp[i][0] = i;
	for (let j = 0; j < cols; j++) dp[0][j] = j;

	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost,
			);
		}
	}

	return dp[a.length][b.length];
}

function wordSimilarity(spoken, expected) {
	if (!spoken || !expected) return 0;
	if (spoken === expected) return 1;

	const shortest = Math.min(spoken.length, expected.length);
	const longest = Math.max(spoken.length, expected.length);
	if (shortest <= 2) return 0;

	if (shortest >= 4 && (spoken.startsWith(expected) || expected.startsWith(spoken))) {
		return shortest / longest >= 0.75 ? 0.82 : 0;
	}

	const distance = levenshteinDistance(spoken, expected);
	const similarity = 1 - distance / longest;
	return similarity >= 0.72 ? similarity : 0;
}

function scoreScriptWindow(spoken, startIdx, maxScriptWords) {
	const script = words.slice(startIdx, startIdx + maxScriptWords).map(w => w.clean);
	const rows = spoken.length + 1;
	const cols = script.length + 1;
	const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
	const endIdx = Array.from({ length: rows }, () => new Array(cols).fill(startIdx));

	const skipPenalty = -0.65;
	let best = { score: -Infinity, exact: 0, fuzzy: 0, endIdx: -1 };

	for (let i = 1; i < rows; i++) {
		dp[i][0] = dp[i - 1][0] + skipPenalty;
		endIdx[i][0] = startIdx;
	}
	for (let j = 1; j < cols; j++) {
		dp[0][j] = dp[0][j - 1] + skipPenalty;
		endIdx[0][j] = startIdx + j - 1;
	}

	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const similarity = wordSimilarity(spoken[i - 1], script[j - 1]);
			const matchScore = similarity ? similarity * 3 : -1.15;
			const diagonal = dp[i - 1][j - 1] + matchScore;
			const skipSpoken = dp[i - 1][j] + skipPenalty;
			const skipScript = dp[i][j - 1] + skipPenalty;
			const score = Math.max(diagonal, skipSpoken, skipScript);

			dp[i][j] = score;
			endIdx[i][j] = score === skipSpoken ? endIdx[i - 1][j] : startIdx + j - 1;

			if (i === spoken.length && score > best.score) {
				const exact = countExactMatches(spoken, startIdx, j);
				const fuzzy = countFuzzyMatches(spoken, startIdx, j) - exact;
				best = { score, exact, fuzzy, endIdx: endIdx[i][j] };
			}
		}
	}

	return best;
}

function countExactMatches(spoken, startIdx, scriptLength) {
	const script = words.slice(startIdx, startIdx + scriptLength).map(w => w.clean);
	return spoken.reduce((total, token) => total + (script.includes(token) ? 1 : 0), 0);
}

function countFuzzyMatches(spoken, startIdx, scriptLength) {
	const script = words.slice(startIdx, startIdx + scriptLength).map(w => w.clean);
	return spoken.reduce((total, token) => {
		return total + (script.some(expected => wordSimilarity(token, expected) >= 0.72) ? 1 : 0);
	}, 0);
}

/**
 * Finds the best matching word index in the script for the last spoken words.
 * Uses fuzzy alignment against the expected script window to tolerate ASR noise.
 * @param {string[]} spokenWords
 * @returns {number} Index in `words`, or -1 if no match found
 */
function findBestMatch(spokenWords) {
	if (!spokenWords.length) return -1;

	const SEARCH_WINDOW = 30;
	const MATCH_CHAIN   = 6;
	const cleanSpoken   = spokenWords.map(cleanWord).filter(Boolean);
	const lastN         = cleanSpoken.slice(-MATCH_CHAIN);
	if (lastN.length < 2) return -1;

	const start = Math.max(0, currentIdx - 2);
	const end   = Math.min(words.length - 1, currentIdx + SEARCH_WINDOW);
	const maxScriptWords = lastN.length + 3;
	let best = { score: -Infinity, exact: 0, fuzzy: 0, endIdx: -1 };

	for (let i = start; i <= end; i++) {
		const candidate = scoreScriptWindow(lastN, i, maxScriptWords);
		const continuityPenalty = Math.abs(i - currentIdx) * 0.08;
		const score = candidate.score - continuityPenalty;

		if (score > best.score) {
			best = { ...candidate, score };
		}
	}

	const requiredMatches = Math.min(3, lastN.length);
	const totalMatches = best.exact + best.fuzzy;
	const hasEnoughMatches = totalMatches >= requiredMatches;
	const hasStrongScore = best.score >= lastN.length * 1.15;

	return hasEnoughMatches && hasStrongScore ? best.endIdx : -1;
}

function handleTranscript(text) {
	document.getElementById('transcript').textContent = '📝 ' + text.slice(-80);
	const spokenWords = text.trim().split(/\s+/).filter(Boolean);
	const matched = findBestMatch(spokenWords);
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
