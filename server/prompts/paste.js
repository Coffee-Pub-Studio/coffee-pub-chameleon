// paste@2: the instructions a person copies into any AI (Chat's "Copy instructions for another AI", GET /api/objects/format), in
// the person's voice, never sent to the in-app model. Version 2 (plan-assistant-reboot.md, step 1) adds a booking's cost, currency
// and travellers to the example and the details lines; it replaces version 1, which the shared catalogue can no longer render.
'use strict';

const { fencedRule } = require('./object-rule');
const { FENCE, FILE_SUFFIX, MAX_IMPORT_OBJECTS } = require('../object-format');

const template = {
  id: 'paste',
  version: 2,
  inputs: ['kinds', 'words'],
  output: null,
  // `product`: PRODUCT_NAME, read by the caller (it is not a template's word).
  text({ kinds, words: w }, { product }) {
    return `I keep my plans and research in ${product}. When I ask you to find or plan something, answer as you normally would, then put every thing worth keeping in one JSON array inside one ${fencedRule({ fence: FENCE, noun: w.object, max: MAX_IMPORT_OBJECTS, kinds })}\nIf I ask for a file instead, write one JSON file named <something>${FILE_SUFFIX} holding {"format":"objects","formatVersion":1,"objects":[...]}, with the same ${w.objects} in that one list. Do not write a separate file or a separate fenced block for each ${w.object}.`;
  },
};

module.exports = { template };
