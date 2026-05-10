const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function read(relativePath) {
	const filePath = path.join(root, relativePath);
	assert(fs.existsSync(filePath), `Missing required file: ${relativePath}`);
	return fs.readFileSync(filePath, 'utf8');
}

function main() {
	const packageJson = JSON.parse(read('package.json'));
	const serverJs = read('server.js');
	const indexHtml = read(path.join('public', 'index.html'));
	const mainJs = read(path.join('public', 'js', 'main.js'));
	const prompterJs = read(path.join('public', 'js', 'prompter.js'));
	const workerJs = read(path.join('public', 'whisper-worker.js'));

	assert(packageJson.main === 'server.js', 'package.json main should point to server.js');
	assert(packageJson.scripts?.start === 'node server.js', 'package.json start script should run server.js');
	assert(serverJs.includes("express.static(path.join(__dirname, 'public'))"), 'server.js must expose public/ as static assets');

	assert(indexHtml.includes('js/main.js'), 'index.html must load js/main.js');
	assert(indexHtml.includes('id="setupNotice"'), 'index.html must include the setup notice region');
	assert(indexHtml.includes('id="sessionNotice"'), 'index.html must include the session notice region');

	assert(mainJs.includes("from './prompter.js'"), 'main.js must import the prompter module');
	assert(mainJs.includes('setSetupNotice'), 'main.js must expose setup notice handling');

	assert(prompterJs.includes('function findBestMatch'), 'prompter.js must define findBestMatch');
	assert(prompterJs.includes('function wordSimilarity'), 'prompter.js must define fuzzy word similarity');
	assert(prompterJs.includes('function scoreScriptWindow'), 'prompter.js must define script-window scoring');
	assert(prompterJs.includes('function submitPayload'), 'prompter.js must define submitPayload');
	assert(prompterJs.includes('function setSessionNotice'), 'prompter.js must define session notice handling');

	assert(workerJs.includes("pipeline('automatic-speech-recognition'"), 'whisper worker must initialize the ASR pipeline');

	console.log('Smoke check passed.');
}

main();
