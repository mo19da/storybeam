'use strict';

/**
 * 100 kid-friendly keywords → Unsplash search queries.
 * Organised by theme, but used for any story segment keyword matching.
 *
 * Format:  keyword: 'unsplash search string'
 * Search strings are tuned to return safe, colourful, child-appropriate results.
 */

const KID_KEYWORDS = {
  // ── Animals ──────────────────────────────────────────────────────
  rabbit:      'cute bunny rabbit nature',
  bunny:       'cute bunny rabbit grass',
  lion:        'lion cub savanna',
  elephant:    'baby elephant nature',
  bear:        'bear cub forest nature',
  fox:         'red fox nature forest',
  wolf:        'wolf nature forest wild',
  owl:         'owl bird nature tree',
  deer:        'baby deer fawn forest',
  duck:        'duck pond nature',
  frog:        'frog nature green pond',
  turtle:      'turtle nature pond',
  butterfly:   'butterfly flower colorful nature',
  horse:       'horse field nature',
  cat:         'cute cat kitten',
  dog:         'cute puppy dog',
  puppy:       'cute puppy dog playful',
  bird:        'colorful bird nature branch',
  fish:        'colorful fish aquarium',
  whale:       'whale ocean blue sea',
  dolphin:     'dolphin ocean jumping',
  monkey:      'monkey jungle tree',
  giraffe:     'giraffe savanna Africa',
  zebra:       'zebra Africa savanna',
  penguin:     'penguin snow cute',
  flamingo:    'flamingo pink bird',
  parrot:      'colorful parrot bird',
  squirrel:    'cute squirrel nature acorn',
  hedgehog:    'cute hedgehog nature',
  sheep:       'lamb sheep green field',
  cow:         'cow field green farm',
  chicken:     'baby chick chicken farm',
  tiger:       'tiger cub nature wild',
  panda:       'panda bear bamboo cute',
  koala:       'koala tree cute australia',
  crocodile:   'crocodile river nature',
  snake:       'snake nature colorful',
  hamster:     'cute hamster pet',
  mouse:       'cute mouse nature',
  rat:         'cute rat nature',

  // ── Dinosaurs ──────────────────────────────────────────────────────
  dinosaur:    'dinosaur nature prehistoric',
  trex:        'tyrannosaurus dinosaur',
  pterodactyl: 'pterodactyl flying dinosaur sky',
  stegosaurus: 'stegosaurus dinosaur',
  volcano:     'volcano eruption nature dramatic',
  fossil:      'fossil rock ancient nature',

  // ── Space ──────────────────────────────────────────────────────────
  rocket:      'rocket launch space stars',
  star:        'stars night sky space',
  moon:        'full moon night sky glow',
  planet:      'planet space colorful',
  astronaut:   'astronaut space suit stars',
  galaxy:      'galaxy stars milky way',
  comet:       'comet night sky stars',
  sun:         'sun sunrise golden sky',
  nebula:      'nebula colorful space',
  telescope:   'telescope stars night sky',

  // ── Ocean ──────────────────────────────────────────────────────────
  octopus:     'octopus ocean underwater',
  crab:        'crab beach ocean',
  starfish:    'starfish ocean beach sand',
  coral:       'coral reef colorful underwater',
  jellyfish:   'jellyfish ocean glow',
  submarine:   'submarine ocean underwater',
  lighthouse:  'lighthouse coast ocean',
  beach:       'beach sand ocean waves',
  seashell:    'seashells beach colorful',
  seahorse:    'seahorse underwater ocean',
  shark:       'shark ocean blue water',
  mermaid:     'mermaid ocean fantasy',

  // ── Castles & Fantasy ──────────────────────────────────────────────
  castle:      'castle medieval stone',
  princess:    'princess dress sparkle',
  knight:      'knight armor medieval',
  dragon:      'dragon fantasy colorful',
  tower:       'castle tower medieval',
  crown:       'golden crown jewels',
  sword:       'sword medieval fantasy',
  shield:      'shield medieval knight',
  throne:      'throne golden palace',
  dungeon:     'dungeon stone castle',

  // ── Magic ──────────────────────────────────────────────────────────
  fairy:       'fairy wings magical forest',
  unicorn:     'unicorn magical colorful',
  wizard:      'wizard hat stars magic',
  wand:        'magic wand sparkle stars',
  rainbow:     'rainbow colorful sky',
  crystal:     'crystal gems colorful light',
  potion:      'potion bottle colorful magic',
  magic:       'magic sparkle light colorful',
  spell:       'sparkles magic light',
  elf:         'elf fantasy forest magical',

  // ── Nature & Settings ──────────────────────────────────────────────
  tree:        'big tree nature forest',
  flower:      'colorful flowers nature',
  cloud:       'fluffy clouds blue sky',
  river:       'river nature flowing water',
  waterfall:   'waterfall nature beautiful',
  mountain:    'mountain landscape nature',
  cave:        'cave nature rock light',
  meadow:      'green meadow flowers nature',
  pond:        'pond nature reflections',
  leaf:        'colorful leaves nature autumn',
  mushroom:    'mushroom forest nature',
  rainbow:     'rainbow colorful sky nature',
  forest:      'forest trees green light',
  jungle:      'jungle tropical green lush',
  garden:      'flower garden colorful nature',
  island:      'tropical island ocean paradise',
  waterfall:   'waterfall nature green',
  snow:        'snow winter trees white',
  rain:        'rain drops nature green',
  sunset:      'sunset golden sky colorful',

  // ── Objects & Scenes ───────────────────────────────────────────────
  house:       'cozy cottage house nature',
  boat:        'wooden boat river nature',
  balloon:     'colorful hot air balloon sky',
  cake:        'birthday cake colorful',
  book:        'open book magic light',
  lamp:        'glowing lantern warm light',
  lantern:     'paper lantern glow warm',
  treasure:    'treasure chest gold jewels',
  key:         'old key metal vintage',
  bridge:      'stone bridge nature river',
  candle:      'candle flame warm glow',
  map:         'old treasure map adventure',
  gift:        'gift box colorful ribbon',
  kite:        'kite flying blue sky',
  swing:       'swing park nature',

  // ── Characters & Actions ───────────────────────────────────────────
  child:       'happy child playing nature',
  baby:        'happy baby smiling',
  family:      'family nature happy together',
  friends:     'children playing happy together',
  sleeping:    'sleeping cozy bed warm',
  dancing:     'dancing colorful joyful',
  running:     'child running field happy',
  laughing:    'child laughing happy joyful',
  picnic:      'picnic nature happy colorful',
  adventure:   'adventure nature path forest',
};

// Theme → fallback search if no keyword matches
const THEME_FALLBACKS = {
  animals:    'cute animals nature colorful',
  castles:    'castle fantasy medieval colorful',
  space:      'space stars galaxy colorful',
  magic:      'magic sparkle fantasy colorful',
  dinosaurs:  'dinosaur prehistoric nature',
  ocean:      'ocean underwater colorful fish',
};

// All known keywords as a flat array for fast lookup
const ALL_KEYWORDS = Object.keys(KID_KEYWORDS);

/**
 * Extract the best matching keyword from an imagePrompt + theme.
 * heroName is checked first so the hero animal always dominates image selection.
 * Returns { keyword, searchQuery }.
 */
function extractKeyword(imagePrompt, theme, heroName) {
  // Hero priority: check hero first so "dog" hero always gets dog photos
  if (heroName) {
    const heroLower = heroName.toLowerCase().trim();
    // Try each word in the hero name (e.g. "brave wolf" → try "wolf" first)
    const heroWords = heroLower.split(/\W+/).reverse(); // last word (noun) first
    for (const word of heroWords) {
      if (KID_KEYWORDS[word]) {
        return { keyword: word, searchQuery: KID_KEYWORDS[word] };
      }
    }
    // Substring match within keywords (e.g. "wolves" → "wolf")
    for (const kw of ALL_KEYWORDS) {
      if (heroLower.includes(kw) || kw.includes(heroLower)) {
        return { keyword: kw, searchQuery: KID_KEYWORDS[kw] };
      }
    }
  }

  const lower = imagePrompt.toLowerCase();
  const words  = lower.split(/\W+/);

  // Direct match first
  for (const word of words) {
    if (KID_KEYWORDS[word]) {
      return { keyword: word, searchQuery: KID_KEYWORDS[word] };
    }
  }

  // Substring match (e.g. "rabbits" → "rabbit")
  for (const kw of ALL_KEYWORDS) {
    if (lower.includes(kw)) {
      return { keyword: kw, searchQuery: KID_KEYWORDS[kw] };
    }
  }

  // Theme fallback
  const fallback = THEME_FALLBACKS[theme] || 'colorful nature children illustration';
  return { keyword: theme, searchQuery: fallback };
}

module.exports = { KID_KEYWORDS, THEME_FALLBACKS, ALL_KEYWORDS, extractKeyword };
