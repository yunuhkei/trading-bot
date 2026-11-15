# Hollow Saints: game design document

Stage 2 of `DEVELOPMENT_PROMPT.md`. Builds on `PITCH.md`. Anything marked **(v1)** is in version 1. **(later)** comes after launch, and **(cut)** is out.

---

## 1. Story bible

### The truth (spoilers, revealed in Chapter 5)
Six years ago, Elias Crowe was a narcotics detective under Captain Augustine Hale, and he was in debt to the wrong people. The Hollow Saints paid that debt and owned him after that.

The Saints run Port Calvary through **St. Jude's Harbor Mission**, a church shelter that is a front for trafficking drugs and people through the docks. **June Adeyemi**, a 19-year-old volunteer at the Mission, saw the books and agreed to testify. Hale ordered Crowe to bring her in "for protection." Crowe delivered her. Hale's men killed her, and Crowe was told to put her body in the harbor.

He did it drunk and dosed on **Communion**, the Saints' drug that wipes short-term memory. They use it on everyone they need to keep quiet.

Days later Crowe cracked and threatened to go to Internal Affairs. Hale shot a second witness, **Dario Pell**, in the Ninth Precinct interview room, put the gun in Crowe's hand and dosed him again. Crowe woke up with blood on his shirt, no memory, and a murder charge.

**So:** Crowe didn't kill the man he went to prison for. He did hand June to her killers and help hide her body. He's guilty, just not of the crime he was convicted of.

### The arc in five chapters

Each chapter focuses on one of the **five key Saints**. The ledger names eleven, and the other six are minor targets, side jobs or collectible clues.

| # | Chapter | Saint | District | What Crowe learns |
|---|---|---|---|---|
| 1 | **Hymn for the Drowned** *(built)* | (escape) | City, Vesper St. | The Saints framed him. Mars is dead. The ledger exists, and its last page is in his handwriting. |
| 2 | **The Bishop's Garden** | **Brother Cass**, masked leader of the enforcers | St. Jude's church and graveyard | The church graveyard hides bodies, and the Saints' money runs through the Mission. |
| 3 | **Paper Crowns** | **Judge Miriam Vance**, who sells sentences | Downtown courthouse towers | The name **June Adeyemi**, and that Crowe signed her transfer papers. |
| 4 | **Cold Water** | **Deputy Mayor Lionel Ashby** | Whitepine and Ashby's mountain lodge | **Communion** exists, Crowe was dosed, and his old partner **Sam Whitlock** is on the list. |
| 5 | **Last Rites** | **Captain Hale** and **Bishop Aurelio Marchetti** | Harbor freighter, lighthouse, St. Jude's | The full truth about June, Pell, and who Crowe really was. |

### Ending (v1)
In the final scene, at the lighthouse, Crowe holds the ledger and the proof of his own guilt. The player chooses:
- **Confession:** send everything to the press. The Saints fall, and so does Crowe; he walks into the Ninth Precinct and surrenders. The epilogue shows June's mother at the harbor.
- **Communion:** burn the ledger and take the Saints' place. The epilogue shows Crowe in Hale's office, wearing a halo pin. The city stays the same, with a new owner.

### Tone rules
- It's always night. The whole story happens over six nights, which suits noir and keeps the lighting consistent. Day/night cycle **(cut)**.
- Violence is sudden and has consequences. Bodies stay, and people react.
- Crowe is never a hero. The writing doesn't excuse him.
- Dialogue is short and hard-boiled, with no jokes in serious scenes.

---

## 2. Characters

| Character | Role | Notes |
|---|---|---|
| **Elias Crowe** | Player | 40s, ex-detective, brown trench coat. Tired and dry. Talks to himself in subtitles. |
| **Lucia Ortega** | Ally (from Ch. 2) | Mars's younger sister, a mechanic who wants revenge. Gives you cars, garages and phone calls. She doesn't fully trust Crowe, rightly. |
| **Sam Whitlock** | Ally, then traitor (Ch. 4) | Crowe's retired partner and a drunk. Helps in Ch. 2–3. In Ch. 4 he turns out to be Saint #9, the one who dosed Crowe. Boss fight in the snow. |
| **Brother Cass** | Ch. 2 Saint | Leads the masked enforcers. Never speaks; wears a cracked porcelain mask and a gold halo. |
| **Judge Miriam Vance** | Ch. 3 Saint | Cold, precise, afraid of dying. Can be spared after she talks. |
| **Lionel Ashby** | Ch. 4 Saint | The deputy mayor, a coward with private security. Hides at his lodge above Whitepine. |
| **Captain Augustine Hale** | Ch. 5 Saint | Runs the Ninth Precinct. The main villain: calm and fatherly, and he truly believes he keeps order. |
| **Bishop Aurelio Marchetti** | Ch. 5 Saint | Spiritual head of the Saints. Communion was his idea. Final confrontation in St. Jude's. |
| **June Adeyemi** | The victim | Seen only in photos, Mission records and a single voicemail. The moral center of the story. |
| **Marisol "Mars" Ortega** | Ch. 1 victim | Informant. Appears in flashback phone recordings. |
| **The Saints' enforcers** | Enemies | White masks, hoods, halos. Tougher than cops. |
| **Ninth Precinct police** | Enemies | Ordinary cops. Some are Saints, most aren't. Killing cops raises the wanted level and costs story trust. |

---

## 3. Missions (v1)

Each mission adds one new thing (a mechanic, place or set piece), so the game keeps teaching.

### Chapter 1: Hymn for the Drowned *(built; gets a polish pass)*
| Mission | Objective | Where | Set piece | New |
|---|---|---|---|---|
| 1.1 Hymn for the Drowned | Escape, find Mars, survive, reach the motel | Harbor Line, Vesper St. | Laundromat ambush, 3-star escape | Movement, shooting, driving, wanted level |
| 1.2 Room 9 *(new)* | Hide the ledger, buy a gun, meet Lucia | Motel, pawn shop | First shop visit | **Saving, money, shops, safehouse** |

### Chapter 2: The Bishop's Garden
| Mission | Objective | Where | Set piece | New |
|---|---|---|---|---|
| 2.1 Night Vigil *(vertical slice)* | Stake out St. Jude's, follow the hearse | Church, city streets | Tailing a car without being seen | **Cutscene system**, tailing |
| 2.2 Shallow Graves | Search the graveyard while Saints dig | Church graveyard | Night firefight among gravestones | **Shotgun**, enemies that use cover |
| 2.3 Whitlock | Get Sam sober enough to help | Bar, his apartment | Bar brawl | **Melee** (later: simple punches in v1) |
| 2.4 The Mask | Hunt Brother Cass through the Mission | Harbor Mission interior | Boss fight in a burning shelter | **First interior**, boss fight |

### Chapter 3: Paper Crowns
| Mission | Objective | Where | Set piece | New |
|---|---|---|---|---|
| 3.1 Docket | Steal court records from the courthouse | Downtown | Stealth, then alarm, then escape | **SMG** |
| 3.2 Bailiff | Chase Vance's bodyguard down the coast road | Coast highway | High-speed chase | **Traffic**, chase AI |
| 3.3 Paper Crowns | Corner Vance in her penthouse | Downtown tower roof | Rooftop standoff, a choice: spare her or kill her | **Choices** |

### Chapter 4: Cold Water
| Mission | Objective | Where | Set piece | New |
|---|---|---|---|---|
| 4.1 The Long Climb | Escort Lucia's truck up the mountain road | Mountain road | Snowstorm ambush | **Armor vests**, snow driving |
| 4.2 Whitepine | Find Ashby's courier in the village | Whitepine | Search the village, interrogate | Villagers react, investigation |
| 4.3 Communion | Assault Ashby's lodge | Mountain lodge | Sniping from the ridge, then storming the lodge | **Rifle** |
| 4.4 Old Partners | Sam's betrayal | Frozen lake | Boss duel on the ice | Twist reveal |

### Chapter 5: Last Rites
| Mission | Objective | Where | Set piece | New |
|---|---|---|---|---|
| 5.1 Manifest | Get aboard the freighter | Harbor, freighter | Assault the ship | Boarding (boats come later) |
| 5.2 The Ninth | Break into the Ninth Precinct for the Pell file | Precinct building | All-out siege, 5 stars | Max wanted level |
| 5.3 Last Rites | Hale and Marchetti | St. Jude's, then the lighthouse | Cathedral fight, then the final choice | **Ending choice** |

**Total in v1:** 17 missions, about 3–4 hours.

---

## 4. Mechanics

### Combat
| Feature | v1 | Details |
|---|---|---|
| Pistol | ✅ | Starter weapon, already built |
| Shotgun | ✅ | Close range, huge knockback on ragdolls |
| SMG | ✅ | Automatic, less accurate, works from cars |
| Rifle | ✅ | Long range, tap to zoom when aiming |
| Melee (punch, bat) | ✅ punches; bat later | Punch combo; heavy ragdoll knockdown |
| Grenades / molotovs | later | |
| Weapon wheel | ✅ | Tap the gun icon to cycle; hold to open a wheel |
| Health | ✅ | Regenerates to 50%, medkits restore to full |
| Armor vest | ✅ | Absorbs damage first; bought or found |
| Cover system | later | Enemies use cover in v1; the player doesn't snap to it |
| Auto-aim | ✅ | Keep it, with a setting for assist strength |

### Wanted level (rework, v1)
- **Police drive in** with sirens instead of appearing out of nowhere, using traffic AI.
- **Roadblocks** at 4–5 stars. Helicopter later.
- **Story rule:** in Saint-controlled areas, cops can be tipped off by enemies. The Saints *are* the police.
- **Lose them** by breaking line of sight, or by hiding in a garage or safehouse.

### Money and shops (v1)
- **Earned from:** mission rewards, cash dropped by enemies, side jobs.
- **Spent at:**
  - **Pawn shop:** weapons and ammo.
  - **Clinic:** medkits.
  - **Lucia's garage:** repairs, a new paint job (drops one wanted star), saving cars.
- No microtransactions, ever.

### Saving (v1)
- Autosave after each mission and at checkpoints.
- Manual save at safehouses.
- Saved data: story progress, money, weapons, ammo, stats, collectibles, choices.
- Stored in the browser (localStorage), with a backup code you can copy (a short text string) in case the browser clears it.

### Safehouses (v1)
| Safehouse | Location | Unlocked |
|---|---|---|
| Calvary Motel, room 9 | City, west | Ch. 1 |
| Lighthouse keeper's house | East cape | Ch. 3 |
| Cabin 7, Whitepine | North | Ch. 4 |

Each one is a save point, a respawn point and a place to restock ammo.

### Vehicles
| Vehicle | v1 | Notes |
|---|---|---|
| Sedan, van, police car | ✅ | Built already |
| Pickup truck | ✅ | Better in snow |
| Motorbike | later | Needs leaning physics and its own controls |
| Boat | later | The island makes this a natural expansion |
| Traffic AI | ✅ | Cars follow city streets and country roads, stop and honk, and flee gunfire |

### Side activities (v1)
- **Tin halos:** 30 collectible Saint halos hidden around the island. Each one unlocks a line of story about the Saints.
- **Minor Saints:** the 6 other names in the ledger. Each is a short hunt that rewards money and story.
- **Street crimes:** random events (a mugging, a robbery). Step in for money. Ignoring them is fine.
- Races, taxi jobs, property ownership: **later**.

---

## 5. The world, area by area

| Area | What it's for in the story | What you do there | New work needed |
|---|---|---|---|
| **Vesper Street** (laundromat block) | Ch. 1, nightlife | Bars, pawn shop | Bar entrance, a working pawn shop |
| **St. Jude's** (church block) | Ch. 2, Ch. 5 finale | Graveyard, Mission | Church interior, Mission interior |
| **Downtown** (center, tall towers) | Ch. 3 | Courthouse, penthouse | Courthouse landmark, a reachable rooftop |
| **Ninth Precinct** | Ch. 5 | Siege | Precinct landmark building with an interior |
| **Motel strip** (west) | Safehouse | Saving, shopping | Usable motel room |
| **Harbor** | Ch. 5, smuggling | Freighter, containers | Freighter deck you can walk on |
| **Coast highway** | Chases | Driving | Traffic |
| **Lakes** | Body dumps (story clues) | Collectibles | Small piers |
| **Lighthouse cape** | Safehouse, ending | Final scene | Keeper's house interior |
| **Forest and radio hill** | Atmosphere | Halos, hunts | — |
| **Whitepine** | Ch. 4 | Village, gas station | More villagers, the courier's cabin |
| **Ashby's lodge** (mountain) | Ch. 4 | Assault | New landmark on a ridge |
| **Frozen lake** (north) | Ch. 4 boss | Ice duel | Icy terrain, a slippery surface |

Interiors stay small and few, and only where the story needs them: the church, Mission, precinct, lodge, motel room and keeper's house.

---

## 6. Controls (touch, landscape)

| Mode | Left thumb | Right thumb | Other |
|---|---|---|---|
| **On foot** | Joystick (push fully to sprint) | Drag to look; FIRE; RUN toggle; RELOAD; CAR | Weapon icon (top right): tap to cycle, hold for the wheel |
| **Aiming** (holding FIRE) | Joystick moves slowly | Drag fine-tunes the aim | Rifle: a ZOOM button appears |
| **Driving** | ◀ ▶ steer | GAS, BRAKE/reverse, HAND BRAKE, SHOOT, EXIT | Radio button (later) |
| **Menus** | — | Tap | Pause has a map, mission log, settings and save |

**Settings (v1):** look sensitivity, auto-aim strength, button size, left-handed layout, graphics level, sound and music volume.
**First-time tutorial (v1):** prompts during Mission 1.1, so controls make sense within a minute.

---

## 7. Tech plan

### Build order (each step is tested, published and committed)
1. **Save system** and a data-driven **mission framework**, so missions are written as data and checkpoints become easy.
2. **Weapons:** shotgun, SMG, rifle, punches, the weapon wheel, ammo, pickups.
3. **Money, shops, armor, medkits, safehouses.**
4. **Traffic AI** on the city grid and country roads; police that drive in.
5. **Cutscene system:** in-engine camera shots, subtitles, letterbox.
6. **People v2:** more body types, clothes, faces, simple facial animation, better walk cycles.
7. **Enemy AI v2:** cover points, flanking, retreating when hurt.
8. **Audio v2:** music themes per chapter (generated), ambience by area, dialogue sounds.
9. **Interiors:** small walk-in rooms loaded on demand.
10. **Chapters 2–5,** built from all of the above.

### Performance budget (mid-range phone)
| Metric | Target |
|---|---|
| Frame rate | 30+ fps mid-range, 60 fps high-end |
| Draw calls | under 150 |
| Triangles on screen | under 300k |
| JavaScript per frame | under 6 ms |
| Load time | under 5 s |
| Memory | under 300 MB |
| Page size | under 1.5 MB (one file) |

### Risks
| Risk | How we handle it |
|---|---|
| Real-phone performance is unknown | Test on your phone after every stage; add a built-in FPS display in settings |
| iPhone Safari limits (no fullscreen, audio unlock) | Design around them; an "add to home screen" tip |
| Art ceiling (everything is code-made, no 3D artist) | Lean into a stylized look: strong silhouettes, lighting and atmosphere rather than detail |
| Lots of story writing | Write each chapter's script before building it |
| Single-file size keeps growing | Keep everything code-generated (no big image or sound files) |
| Save data lost when the browser clears it | Backup code you can copy |

---

## 8. Scope

### Version 1
- **Story:** 5 chapters (17 missions), two endings.
- **Combat:** pistol, shotgun, SMG, rifle, punches, a weapon wheel, armor and medkits.
- **Economy:** money, shops (pawn shop, clinic, garage), saving and 3 safehouses.
- **World:** traffic AI, police that drive in, roadblocks, a pickup truck.
- **Presentation:** cutscenes with subtitles, generated music, a tutorial, settings, a full-screen map.
- **Extras:** 30 tin halos, 6 minor Saints, street crimes, and 6 small interiors.

### Later (post-launch updates)
- Motorbikes, boats, a helicopter at 5 stars.
- Grenades, molotovs, a baseball bat, a player cover system.
- Races, taxi jobs, owning property.
- Radio stations, phone calls between missions.
- A new chapter or district after launch.

### Cut
- Day/night cycle (it's always night by design).
- Multiplayer.
- Character customization.
- Microtransactions.
