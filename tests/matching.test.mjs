import test from 'node:test';
import assert from 'node:assert/strict';

import {
	cleanWord,
	findBestMatch,
	scoreScriptWindow,
	wordSimilarity,
} from '../public/js/matching.mjs';

const SCRIPT_TEXT = 'Hello world this is a simple teleprompter script for testing voice tracking behavior';
const SCRIPT_WORDS = SCRIPT_TEXT.split(/\s+/).map(cleanWord);

test('cleanWord normalizes punctuation and diacritics', () => {
	assert.equal(cleanWord('Caf\u00e9,'), 'cafe');
	assert.equal(cleanWord("ni\u00f1o's"), "nino's");
});

test('wordSimilarity accepts close Whisper-like mistakes', () => {
	assert.equal(wordSimilarity('teleprompter', 'teleprompter'), 1);
	assert.ok(wordSimilarity('helo', 'hello') >= 0.72);
	assert.ok(wordSimilarity('trackin', 'tracking') >= 0.72);
	assert.equal(wordSimilarity('hi', 'hello'), 0);
});

test('scoreScriptWindow rewards nearby fuzzy matches', () => {
	const spoken = ['helo', 'wurld', 'this', 'is'];
	const near = scoreScriptWindow(SCRIPT_WORDS, spoken, 0, 7);
	const far = scoreScriptWindow(SCRIPT_WORDS, spoken, 5, 7);

	assert.ok(near.score > far.score);
	assert.ok(near.endIdx >= 2);
});

test('findBestMatch advances on fuzzy transcript fragments near the current window', () => {
	const spoken = ['helo', 'wurld', 'this', 'is', 'simple'];
	const match = findBestMatch(SCRIPT_WORDS, 0, spoken);

	assert.ok(match >= 3);
	assert.ok(match <= 5);
});

test('findBestMatch rejects unrelated speech', () => {
	const spoken = ['banana', 'spaceship', 'volcano', 'triangle'];
	assert.equal(findBestMatch(SCRIPT_WORDS, 0, spoken), -1);
});
