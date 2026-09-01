#!/usr/bin/env node
/**
 * Builds the addon, falling back to the system's Node headers when
 * node-gyp cannot download them.
 *
 * node-gyp normally fetches headers from nodejs.org. That fails on any
 * machine without access to it — an offline build, a restricted network,
 * or a sandbox. Most distributions ship the same headers in
 * /usr/include/node (Debian/Ubuntu's libnode-dev), so try the download
 * path first and fall back rather than failing outright.
 */
const { execFileSync } = require('child_process');
const { existsSync } = require('fs');

function run(args) {
  execFileSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), ...args], {
    stdio: 'inherit',
    cwd: __dirname,
  });
}

try {
  run(['rebuild']);
} catch {
  if (!existsSync('/usr/include/node/node_api.h')) {
    console.error(
      '\nCould not download Node headers, and none found at /usr/include/node.\n' +
        'Install them with:  sudo apt-get install -y libnode-dev\n',
    );
    process.exit(1);
  }
  console.error('\nHeader download failed; retrying against system headers in /usr...\n');
  run(['rebuild', '--nodedir=/usr']);
}
