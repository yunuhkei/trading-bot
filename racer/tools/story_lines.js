// Lists every story line for voice recording: node racer/tools/story_lines.js > racer/story/lines.csv
// Columns: id (name the recorded file <id>.mp3 and put it in racer/assets/vox/), character, where it plays, line, direction.
const fs=require('fs'),path=require('path'),vm=require('vm');
const src=fs.readFileSync(path.join(__dirname,'..','src','74_story.js'),'utf8');
const ctx={console};vm.createContext(ctx);vm.runInContext(src.replace(/^'use strict';/,'')+'\nthis.STORY_CH=STORY_CH;this.STORY_WHO=STORY_WHO;',ctx);
const DIR={STATIC:'pirate radio DJ, loud, playful, fast; slight radio crackle',MARGO:'gas station owner, 60s, dry, tired but warm',JULES:'rival, young, proud, bitter edge, never shouts unless it says so',
  DEACON:'surfer crew boss, laid-back, cocky, says brah',FENNEC:'two or three teenage voices at once, hyped',YOU:'the player, few words, calm',"":'(narration, not voiced)'};
const where={l:'scene',drive:'radio while driving',pre:'scene before the race',win:'radio after winning',lose:'radio after losing',ws:'scene after winning'};
const q=s=>'"'+String(s).replace(/"/g,'""')+'"';const rows=[['id','character','where','line','direction'].join(',')];
for(const ch in ctx.STORY_CH)for(const s of ctx.STORY_CH[ch].steps){for(const [k,L] of [['l',s.lines],['drive',s.drive],['pre',s.pre],['win',s.win],['lose',s.lose],['ws',s.winScene&&s.winScene.lines]]){if(!L)continue;
  for(const l of L){if(!l[0])continue;rows.push([l[2].id,(ctx.STORY_WHO[l[0]]||{n:l[0]}).n,where[k]+(l[2].r?' (on the radio)':''),q(l[1]),q(DIR[l[0]]||'')].join(','))}}}
process.stdout.write(rows.join('\n')+'\n');
