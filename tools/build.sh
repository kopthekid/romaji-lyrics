#!/bin/sh
# Rebuilds vendor/libs.js. Run from the repo root: sh tools/build.sh
set -e
cd tools
npm i --no-save pinyin-pro@3.29.5 opencc-js@1.4.2 wanakana@5.3.1 @romanize/korean@0.1.3 esbuild
# @romanize/korean ships an unused require("node:module") that breaks browser bundling
sed 's/^var B=require("node:module");//' node_modules/@romanize/korean/dist/index.js > korean-lib.cjs
npx esbuild entry.mjs --bundle --minify --format=iife --platform=browser --outfile=../vendor/libs.js
