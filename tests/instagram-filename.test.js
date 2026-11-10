"use strict";

const assert = require("node:assert/strict");
const {
  buildStoryFilename,
  extractStoryIdFromMediaUrl,
  getStoryIdentity,
  parseStoryUrl
} = require("../lib/instagram-filename.js");

assert.deepEqual(
  parseStoryUrl("https://www.instagram.com/stories/leomoreiraaa/3712345678901234567/"),
  { username: "leomoreiraaa", storyId: "3712345678901234567" }
);

assert.equal(
  buildStoryFilename({
    pageUrl: "https://www.instagram.com/stories/leomoreiraaa/3712345678901234567/",
    type: "video"
  }),
  "leomoreiraaa_story_3712345678901234567.mp4"
);

assert.equal(
  buildStoryFilename({
    pageUrl: "https://www.instagram.com/stories/leomoreiraaa/",
    storyHref: "/stories/leomoreiraaa/3712345678901234567/",
    mime: "image/jpeg"
  }),
  "leomoreiraaa_story_3712345678901234567.jpg"
);

assert.equal(
  buildStoryFilename({
    pageUrl: "https://www.instagram.com/stories/leomoreiraaa/",
    timestamp: 1794278834656,
    mime: "image/png"
  }),
  "leomoreiraaa_story_1794278834656.png"
);

assert.equal(
  extractStoryIdFromMediaUrl("https://scontent.cdninstagram.com/v/t51/3712345678901234567_123_n.jpg?x=1"),
  "3712345678901234567"
);

assert.deepEqual(
  getStoryIdentity({ pageUrl: "/stories/eddy.sg10/", storyId: "3712345678901234567" }),
  { username: "eddy.sg10", storyId: "3712345678901234567" }
);

console.log("instagram-filename.test.js: ok");
