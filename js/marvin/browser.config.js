const webpack = require('webpack');
const path = require('path');

module.exports = {
  entry: './index.js',
  output: {
    filename: 'marvin.min.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    minimize: true
  },
  watch: false,
  plugins: [
    new webpack.IgnorePlugin(/fs/),
  ],
};