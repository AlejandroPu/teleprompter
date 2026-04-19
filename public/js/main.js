
import {
	buildPrompter,
	initWorker,
	toggleMic,
	toggleAutoScroll,
	togglePanelVisibility,
	setGain,
	reset,
	exit
} from './prompter.js';

// ─────────────────────────────────────────────
//  SETUP SLIDERS
// ─────────────────────────────────────────────
const fontSizeSlider = document.getElementById('fontSizeSlider');
const widthSlider    = document.getElementById('widthSlider');
const gainSlider     = document.getElementById('gainSlider');

document.getElementById('fontSizeVal').textContent = fontSizeSlider.value + 'px';
document.getElementById('widthVal').textContent = widthSlider.value + '%';
document.getElementById('gainVal').textContent = gainSlider.value + '%';

fontSizeSlider.addEventListener('input', () => {
	document.getElementById('fontSizeVal').textContent = fontSizeSlider.value + 'px';
});
widthSlider.addEventListener('input', () => {
	document.getElementById('widthVal').textContent = widthSlider.value + '%';
});
gainSlider.addEventListener('input', () => {
	document.getElementById('gainVal').textContent = gainSlider.value + '%';
	if (monitorGainNode) monitorGainNode.gain.value = gainSlider.value / 100;
});

// ─────────────────────────────────────────────
//  MICROPHONE LIST
// ─────────────────────────────────────────────
const micSelect      = document.getElementById('micSelect');
const micUnlockBtn   = document.getElementById('micUnlockBtn');

async function populateMics() {
	if (!navigator.mediaDevices?.enumerateDevices) return;
	const devices = await navigator.mediaDevices.enumerateDevices();
	const mics    = devices.filter(d => d.kind === 'audioinput');
	const prev    = micSelect.value;
	micSelect.innerHTML = '';

	const def = document.createElement('option');
	def.value = '';
	def.textContent = 'System default';
	micSelect.appendChild(def);

	mics.forEach((d, i) => {
		const opt = document.createElement('option');
		opt.value = d.deviceId;
		opt.textContent = d.label || `Microphone ${i + 1}`;
		micSelect.appendChild(opt);
	});

	if (prev) micSelect.value = prev;
	micUnlockBtn.hidden = mics.every(d => d.label);
}

populateMics();
if (navigator.mediaDevices?.addEventListener) {
	navigator.mediaDevices.addEventListener('devicechange', populateMics);
}

micUnlockBtn.addEventListener('click', async () => {
	try {
		const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		s.getTracks().forEach(t => t.stop());
		await populateMics();
		startMicMonitor();
	} catch (err) {
		alert('Microphone access denied: ' + err.message);
	}
});

micSelect.addEventListener('change', () => {
	if (monitorStream) startMicMonitor();
});

// ─────────────────────────────────────────────
//  MIC LEVEL MONITOR
// ─────────────────────────────────────────────
const micMeterRow  = document.getElementById('micMeterRow');
const micMeterFill = document.getElementById('micMeterFill');
let monitorStream    = null;
let monitorContext   = null;
let monitorRafId     = null;
let monitorGainNode  = null;

async function startMicMonitor() {
	stopMicMonitor();
	try {
		const deviceId = micSelect.value;
		const audio = deviceId ? { deviceId: { exact: deviceId } } : true;
		monitorStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
	} catch (err) {
		console.warn('Mic monitor unavailable:', err.message);
		return;
	}

	monitorContext = new AudioContext();
	const source   = monitorContext.createMediaStreamSource(monitorStream);
	monitorGainNode = monitorContext.createGain();
	monitorGainNode.gain.value = gainSlider.value / 100;
	const analyser = monitorContext.createAnalyser();
	analyser.fftSize = 1024;
	source.connect(monitorGainNode);
	monitorGainNode.connect(analyser);
	const buf = new Uint8Array(analyser.fftSize);

	micMeterRow.hidden = false;

	function tick() {
		analyser.getByteTimeDomainData(buf);
		let sumSq = 0;
		for (let i = 0; i < buf.length; i++) {
			const v = (buf[i] - 128) / 128;
			sumSq += v * v;
		}
		const rms = Math.sqrt(sumSq / buf.length);
		const pct = Math.min(100, Math.round(rms * 180));  // scale up: ~55% peak = full
		micMeterFill.style.width = pct + '%';
		micMeterRow.querySelector('.mic-meter').setAttribute('aria-valuenow', pct);
		monitorRafId = requestAnimationFrame(tick);
	}
	tick();
}

function stopMicMonitor() {
	if (monitorRafId)   { cancelAnimationFrame(monitorRafId); monitorRafId = null; }
	if (monitorStream)  { monitorStream.getTracks().forEach(t => t.stop()); monitorStream = null; }
	if (monitorContext) { monitorContext.close().catch(() => {}); monitorContext = null; }
	monitorGainNode = null;
	micMeterFill.style.width = '0%';
}

// try to start monitor silently if permission is already granted
if (navigator.permissions?.query) {
	navigator.permissions.query({ name: 'microphone' }).then(status => {
		if (status.state === 'granted') startMicMonitor();
	}).catch(() => {});
}

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
const LANG_TO_BCP47 = {
	english:    'en',
	spanish:    'es',
	french:     'fr',
	german:     'de',
	italian:    'it',
	portuguese: 'pt',
	dutch:      'nl',
	russian:    'ru',
	chinese:    'zh',
	japanese:   'ja',
	korean:     'ko',
	arabic:     'ar',
};

document.getElementById('startBtn').addEventListener('click', async () => {
	const raw = document.getElementById('textInput').value.trim();
	if (!raw) return;

	document.documentElement.style.setProperty('--font-size', fontSizeSlider.value + 'px');
	document.documentElement.style.setProperty('--text-width', widthSlider.value + '%');
	document.getElementById('panelFontSlider').value  = fontSizeSlider.value;
	document.getElementById('panelWidthSlider').value = widthSlider.value;
	document.getElementById('panelGainSlider').value  = gainSlider.value;

	buildPrompter(raw);

	// show loading overlay while model downloads
	document.getElementById('setup').style.display          = 'none';
	document.getElementById('loadingOverlay').style.display = 'flex';

	const language = document.getElementById('languageSelect').value;
	const deviceId = micSelect.value || null;
	const gain     = gainSlider.value / 100;
	document.documentElement.lang = LANG_TO_BCP47[language] || 'en';
	stopMicMonitor();
	await initWorker(language, deviceId, gain);
});

// ─────────────────────────────────────────────
//  PANEL CONTROLS
// ─────────────────────────────────────────────
document.getElementById('micBtn').addEventListener('click', toggleMic);

document.getElementById('resetBtn').addEventListener('click', reset);

document.getElementById('exitBtn').addEventListener('click', exit);

document.getElementById('panelFontSlider').addEventListener('input', (e) => {
	document.documentElement.style.setProperty('--font-size', e.target.value + 'px');
});

document.getElementById('panelWidthSlider').addEventListener('input', (e) => {
	document.documentElement.style.setProperty('--text-width', e.target.value + '%');
});

document.getElementById('panelGainSlider').addEventListener('input', (e) => {
	setGain(e.target.value / 100);
	gainSlider.value = e.target.value;
	document.getElementById('gainVal').textContent = e.target.value + '%';
});

const hideHint = document.getElementById('hideHint');
function togglePanel() {
	const isVisible = togglePanelVisibility();
	document.getElementById('panel').classList.toggle('hidden', !isVisible);
	hideHint.textContent = isVisible ? 'Hide panel [H]' : 'Show panel [H]';
}
hideHint.addEventListener('click', togglePanel);

document.addEventListener('keydown', (e) => {
	if (document.getElementById('prompter').style.display === 'none') return;
	if (e.key === 'h' || e.key === 'H') togglePanel();
	if (e.key === ' ') { e.preventDefault(); document.getElementById('micBtn').click(); }
});

let scrollTimeout;
document.getElementById('scrollContainer').addEventListener('wheel', () => {
	toggleAutoScroll(false);
	clearTimeout(scrollTimeout);
	scrollTimeout = setTimeout(() => { toggleAutoScroll(true); }, 3000);
});