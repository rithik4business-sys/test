"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// Regression guards for the plain-transcript terminal (no card UI, free resize).
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf-8');
(0, node_test_1.test)('exec terminal renders no command cards or buttons', () => {
    strict_1.default.ok(!html.includes('tblk-head'), 'no card headers');
    strict_1.default.ok(!html.includes('tblk-body'), 'no card bodies');
    strict_1.default.ok(!html.includes("contains('tblk')"), 'no card host logic in termPrint');
    strict_1.default.ok(!html.includes('data-a="copy"'), 'no copy buttons');
    strict_1.default.ok(!html.includes('runSeq'), 'no dead block id counter');
});
(0, node_test_1.test)('empty command output prints nothing (bash-like)', () => {
    strict_1.default.ok(!html.includes("'(no output)'"), 'no (no output) placeholder');
});
(0, node_test_1.test)('commands echo as plain prompt lines', () => {
    strict_1.default.ok(html.includes('function termBlock(cmd)'), 'termBlock entry kept for call sites');
    strict_1.default.ok(html.includes('\\u276f'), 'prompt separator echoed');
    strict_1.default.ok(html.includes('exit '), 'nonzero exits leave a plain marker');
});
(0, node_test_1.test)('resize sets explicit height (grows and shrinks)', () => {
    strict_1.default.ok(html.includes("el.style.height=h+'px'"), 'drag sets height');
    strict_1.default.ok(html.includes("el.style.maxHeight=h+'px'"), 'drag sets maxHeight');
    strict_1.default.ok(html.includes('__termClamp'), 'stale heights clamped on open');
    strict_1.default.ok(html.includes('#termgrip:after'), 'grip handle styled');
});
(0, node_test_1.test)('exec failures print the server error, not a bare exit code', () => {
    strict_1.default.ok(html.includes("if(!r.ok){termPrint(escQ(j.error||('exec failed: HTTP '+r.status)))"), 'non-OK /api/exec responses surface j.error as plain text');
});
(0, node_test_1.test)('pty can never trap input: connect timeout + remembered fallback', () => {
    strict_1.default.ok(html.includes('if(!t.ready)fail()'), '3s connect timeout falls back');
    strict_1.default.ok(html.includes('var ptyKnownBad=false'), 'availability flag declared');
    strict_1.default.ok(html.includes('if(activeTerm<0){if(ptyKnownBad)newTerm();else newTermPty();}'), 'known-bad pty opens exec instantly');
    strict_1.default.ok(html.includes('ptyKnownBad=false;try{clearTimeout(to);}'), 'successful ready clears the flag');
});
(0, node_test_1.test)('vendor scripts deferred for fast first paint', () => {
    strict_1.default.ok(html.includes('<script src="/vendor/xterm.js" defer>'), 'xterm deferred');
    strict_1.default.ok(html.includes('<script src="/vendor/fit.js" defer>'), 'fit addon deferred');
});
(0, node_test_1.test)('single-tab strip hidden (decluttered header)', () => {
    strict_1.default.ok(html.includes("el.style.display=terms.length>1?'':'none'"), 'tab strip only for 2+ terminals');
});
(0, node_test_1.test)('github panel states the app-login limit in one line', () => {
    strict_1.default.ok(html.includes("App logins can't create repos."), 'condensed app-login note present');
    strict_1.default.ok(!html.includes('App login limits.'), 'verbose note retired');
});
