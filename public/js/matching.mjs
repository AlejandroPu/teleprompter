function cleanWord(w) {
	return w.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^\p{L}\p{N}']/gu, '');
}

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

function countExactMatches(spoken, script) {
	return spoken.reduce((total, token) => total + (script.includes(token) ? 1 : 0), 0);
}

function countFuzzyMatches(spoken, script) {
	return spoken.reduce((total, token) => {
		return total + (script.some(expected => wordSimilarity(token, expected) >= 0.72) ? 1 : 0);
	}, 0);
}

function scoreScriptWindow(scriptWords, spoken, startIdx, maxScriptWords) {
	const script = scriptWords.slice(startIdx, startIdx + maxScriptWords);
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
				const scriptSlice = script.slice(0, j);
				const exact = countExactMatches(spoken, scriptSlice);
				const fuzzy = countFuzzyMatches(spoken, scriptSlice) - exact;
				best = { score, exact, fuzzy, endIdx: endIdx[i][j] };
			}
		}
	}

	return best;
}

function findBestMatch(scriptWords, currentIdx, spokenWords) {
	if (!spokenWords.length) return -1;

	const searchWindow = 30;
	const matchChain = 6;
	const cleanSpoken = spokenWords.map(cleanWord).filter(Boolean);
	const lastN = cleanSpoken.slice(-matchChain);
	if (lastN.length < 2) return -1;

	const start = Math.max(0, currentIdx - 2);
	const end = Math.min(scriptWords.length - 1, currentIdx + searchWindow);
	const maxScriptWords = lastN.length + 3;
	let best = { score: -Infinity, exact: 0, fuzzy: 0, endIdx: -1 };

	for (let i = start; i <= end; i++) {
		const candidate = scoreScriptWindow(scriptWords, lastN, i, maxScriptWords);
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

export {
	cleanWord,
	countExactMatches,
	countFuzzyMatches,
	findBestMatch,
	levenshteinDistance,
	scoreScriptWindow,
	wordSimilarity,
};
