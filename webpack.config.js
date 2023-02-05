const webpack = require('webpack');

const { exec } = require('child_process');
const path = require('path');

const getSocketCmd = "yabai -m query --windows | jq -r '.[] | select(.app == \"VimR\") | .title'";
// const reloadMemexwikiExtCmd = "nvr --remote-expr 'CocAction(\"reloadExtension\", \"coc-memexwiki\")'";
const reloadMemexwikiExtCmd = "nvr --remote-expr 'CocAction(\"runCommand\", \"memexwiki.restartLanguageServer\")'";
const cmd = `NVIM_LISTEN_ADDRESS=$(${getSocketCmd}) ${reloadMemexwikiExtCmd}`;
class CocReloaderPlugin {

  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync(
      'CocReloaderPlugin',
      (_, callback) => {
        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.log(`error: ${error.message}`);
            return null;
          }
          if (stderr) {
            // eslint-disable-next-line no-console
            console.log(`stderr: ${stderr}`);
            return null;
          } else {
            return stdout.trim();
          }
        });
        callback();
      },
    );
  }

}

module.exports = {

  entry: './src/index.ts',

  target: 'node',

  output: {
    path: path.join(__dirname, 'lib'),
    filename: 'index.js',
    libraryTarget: 'commonjs',
  },

  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /build\/Debug\/tree_sitter_(memexwiki|runtime)_binding/i,
    }),
    new CocReloaderPlugin(),
  ],

  mode: process.env.NODE_ENV,

  resolve: {
    extensions: ['.ts', '.js', '.node'],
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: 'ts-loader',
      },
      {
        test: /\.node$/,
        loader: 'node-loader',
      },
    ],
  },

};
