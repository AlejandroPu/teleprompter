
import {
	buildPrompter,
	initWorker,
	toggleMic,
	toggleAutoScroll,
	togglePanelVisibility,
	reset,
	exit  
} from './prompter.js';

// ─────────────────────────────────────────────
//  SETUP SLIDERS
// ─────────────────────────────────────────────
const fontSizeSlider = document.getElementById('fontSizeSlider');
const widthSlider    = document.getElementById('widthSlider');

document.getElementById('fontSizeVal').textContent = fontSizeSlider.value + 'px';
document.getElementById('widthVal').textContent = widthSlider.value + '%';

fontSizeSlider.addEventListener('input', () => {
	document.getElementById('fontSizeVal').textContent = fontSizeSlider.value + 'px';
});
widthSlider.addEventListener('input', () => {
	document.getElementById('widthVal').textContent = widthSlider.value + '%';
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', async () => {
	const raw = document.getElementById('textInput').value.trim();
	if (!raw) return;

	document.documentElement.style.setProperty('--font-size', fontSizeSlider.value + 'px');
	document.documentElement.style.setProperty('--text-width', widthSlider.value + '%');
	document.getElementById('panelFontSlider').value  = fontSizeSlider.value;
	document.getElementById('panelWidthSlider').value = widthSlider.value;

	buildPrompter(raw);

	// show loading overlay while model downloads
	document.getElementById('setup').style.display          = 'none';
	document.getElementById('loadingOverlay').style.display = 'flex';

	await initWorker();
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