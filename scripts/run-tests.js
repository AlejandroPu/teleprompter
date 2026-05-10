const { spawnSync } = require('child_process');
const path = require('path');

function run(args) {
	const result = spawnSync(process.execPath, args, {
		stdio: 'inherit',
		cwd: path.resolve(__dirname, '..'),
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

run(['scripts/ci-smoke.js']);
run(['--test', 'tests/matching.test.mjs']);
