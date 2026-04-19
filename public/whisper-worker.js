import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

let transcriber = null;

async function loadModel() {
	self.postMessage({ type: 'status', text: 'Loading Whisper model...' });
	transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base');
	self.postMessage({ type: 'ready' });
}

self.onmessage = async ({ data }) => {
	if (data.type === 'load') {
		await loadModel();
	} else if (data.type === 'transcribe') {
		if (!transcriber) return;
		try {
			const result = await transcriber(data.audio, {
				sampling_rate: 16000,
				language: data.language,
				task: 'transcribe',
			});
			self.postMessage({ type: 'transcript', text: result.text.trim() });
		} catch (err) {
			self.postMessage({ type: 'error', text: err.message });
		}
	}
};