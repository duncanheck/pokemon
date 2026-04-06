/**
 * API module - handles card lookups using public APIs.
 *
 * Pokemon TCG:  https://api.pokemontcg.io/v2 (free, no key required for basic use)
 * One Piece TCG: https://tcgcsv.com/tcgplayer/68 (free, no key, daily TCGplayer price sync)
 * Invincible TCG: TCGCSV collectibles search + curated reference fallback (no dedicated API exists)
 *
 * TCGCSV is a free public proxy of TCGplayer's catalog+pricing API.
 * URL scheme: https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/products
 *             https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/prices
 */

const CardAPI = (() => {

  // ─────────────────────────────────────────────
  // POKEMON TCG  (pokemontcg.io v2)
  // categoryId 3 on TCGplayer / TCGCSV
  // ─────────────────────────────────────────────
  const POKEMON_API_BASE = 'https://api.pokemontcg.io/v2';

  async function searchPokemon(query, setId = '') {
    let searchQuery = `name:"${sanitizeQuery(query)}*"`;
    if (setId) searchQuery += ` set.id:${sanitizeQuery(setId)}`;

    const url = `${POKEMON_API_BASE}/cards?q=${encodeURIComponent(searchQuery)}&pageSize=20&orderBy=-set.releaseDate`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Pokemon API request failed');

    const data = await response.json();
    return (data.data || []).map(mapPokemonCard);
  }

  // Fetch every card in a specific set at once (e.g. setId = 'sv6')
  async function getPokemonSet(setId) {
    if (!setId) throw new Error('setId required');
    // pageSize 250 covers the largest sets; use pagination if total > 250
    const url = `${POKEMON_API_BASE}/cards?q=${encodeURIComponent(`set.id:${sanitizeQuery(setId)}`)}&pageSize=250&orderBy=number`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch Pokemon set ${setId}`);
    const data = await response.json();
    const cards = data.data || [];

    // If the set has more than 250 cards, fetch remaining pages
    const total = data.totalCount || cards.length;
    if (total > 250) {
      const pages = Math.ceil(total / 250);
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          fetch(`${POKEMON_API_BASE}/cards?q=${encodeURIComponent(`set.id:${sanitizeQuery(setId)}`)}&pageSize=250&page=${i + 2}&orderBy=number`)
            .then(r => r.json())
            .then(d => d.data || [])
        )
      );
      cards.push(...rest.flat());
    }
    return cards.map(mapPokemonCard);
  }

  // List all sets ordered by newest first
  async function getPokemonSets() {
    const url = `${POKEMON_API_BASE}/sets?orderBy=-releaseDate&pageSize=250`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch Pokemon sets');
    const data = await response.json();
    return (data.data || []).map(s => ({
      id: s.id,
      name: s.name,
      series: s.series,
      total: s.total,
      releaseDate: s.releaseDate,
      symbolUrl: s.images ? s.images.symbol : '',
      logoUrl: s.images ? s.images.logo : '',
    }));
  }

  function mapPokemonCard(card) {
    return {
      apiId: card.id,
      name: card.name,
      set: card.set ? card.set.name : '',
      setId: card.set ? card.set.id : '',
      number: card.number || '',
      rarity: card.rarity || '',
      imageUrl: card.images ? (card.images.small || '') : '',
      imageLarge: card.images ? (card.images.large || '') : '',
      artist: card.artist || '',
      types: card.types || [],
      supertype: card.supertype || '',
      subtypes: card.subtypes || [],
      hp: card.hp || '',
      evolvesFrom: card.evolvesFrom || '',
      legalities: card.legalities || {},
      prices: extractPokemonPrices(card),
    };
  }

  function extractPokemonPrices(card) {
    const prices = {};
    if (card.tcgplayer && card.tcgplayer.prices) {
      const p = card.tcgplayer.prices;
      for (const variant of Object.keys(p)) {
        if (p[variant] && p[variant].market != null) {
          prices[variant] = {
            market: p[variant].market,
            low: p[variant].low ?? null,
            mid: p[variant].mid ?? null,
            high: p[variant].high ?? null,
          };
        }
      }
    }
    if (card.cardmarket && card.cardmarket.prices) {
      prices.cardmarket = {
        averageSellPrice: card.cardmarket.prices.averageSellPrice ?? null,
        trendPrice: card.cardmarket.prices.trendPrice ?? null,
      };
    }
    return prices;
  }

  function getBestPokemonPrice(prices) {
    if (!prices) return null;
    for (const variant of Object.keys(prices)) {
      if (variant === 'cardmarket') continue;
      if (prices[variant]?.market != null) return prices[variant].market;
    }
    return prices.cardmarket?.trendPrice ?? null;
  }


  // ═════════════════════════════════════════════════════════════════
// FIXED ONE PIECE TCG INTEGRATION
// ═════════════════════════════════════════════════════════════════

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const ONEPIECE_CATEGORY = 68;

// ─────────────────────────────────────────────
// API FUNCTIONS
// ─────────────────────────────────────────────

// List all One Piece sets (groups)
async function getOnePieceSets() {
  const response = await fetch(`${TCGCSV_BASE}/${ONEPIECE_CATEGORY}/groups`);
  if (!response.ok) throw new Error('Failed to fetch One Piece sets');
  const data = await response.json();
  return (data.results || []).map(g => ({
    id: g.groupId,
    name: g.name,
    abbreviation: g.abbreviation || '',
    publishedOn: g.publishedOn || '',
  }));
}

// Fetch all cards + prices for a specific set in one go
async function getOnePieceSet(groupId) {
  const [productsRes, pricesRes] = await Promise.all([
    fetch(`${TCGCSV_BASE}/${ONEPIECE_CATEGORY}/${groupId}/products`),
    fetch(`${TCGCSV_BASE}/${ONEPIECE_CATEGORY}/${groupId}/prices`),
  ]);
  if (!productsRes.ok) throw new Error(`Failed to fetch One Piece set ${groupId}`);
  if (!pricesRes.ok) throw new Error(`Failed to fetch One Piece prices for set ${groupId}`);
  
  const [productsData, pricesData] = await Promise.all([
    productsRes.json(),
    pricesRes.json(),
  ]);
  
  // Build a price map keyed by productId
  const priceMap = buildPriceMap(pricesData.results || []);
  
  // Filter to only actual cards (have a Rarity or Number in extendedData)
  const cards = (productsData.results || []).filter(p => isCard(p));
  return cards.map(p => mapOnePieceProduct(p, priceMap));
}

// Name search across all One Piece cards
async function searchOnePiece(query) {
  const sets = await getOnePieceSets();
  if (!sets.length) return [];
  const q = sanitizeQuery(query).toLowerCase();
  
  // Search the most recent 8 sets to keep it snappy
  const recentSets = sets.slice(0, 8);
  const results = await Promise.all(
    recentSets.map(s => getOnePieceSet(s.id).catch(() => []))
  );
  
  return results.flat().filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.number.toLowerCase().includes(q)
  );
}

function mapOnePieceProduct(product, priceMap) {
  const ext = parseExtendedData(product.extendedData || []);
  const prices = priceMap[product.productId] || {};
  
  return {
    apiId: String(product.productId),
    name: product.name || '',
    set: '',          // Will be filled by caller
    setGroupId: product.groupId,
    number: ext.Number || '',
    rarity: ext.Rarity || '',
    imageUrl: product.imageUrl
      ? product.imageUrl.replace('_200w.jpg', '_400w.jpg')
      : '',
    color: ext.Color || '',
    type: ext['Card Type'] || ext.Type || '',
    cost: ext.Cost || '',
    power: ext.Power || '',
    counter: ext.Counter || '',
    effect: ext['Card Text'] || ext.Effect || '',
    attribute: ext.Attribute || '',
    tcgplayerUrl: product.url || '',
    prices,
  };
}

function getBestOnePiecePrice(prices) {
  if (!prices) return null;
  // Prefer Normal, then Holofoil, then any available variant
  for (const variant of ['Normal', 'Holofoil', ...Object.keys(prices)]) {
    if (prices[variant]?.market != null) return prices[variant].market;
  }
  return null;
}

// ─────────────────────────────────────────────
// UI INTEGRATION FUNCTIONS
// ─────────────────────────────────────────────

// Load sets into the dropdown
async function loadOnePieceSets() {
  const setSelect = document.getElementById('onepiece-set-select');
  if (!setSelect) return;
  
  try {
    setSelect.innerHTML = '<option value="">Loading sets...</option>';
    const sets = await getOnePieceSets();
    
    setSelect.innerHTML = '<option value="">Select a set</option>';
    sets.forEach(set => {
      const option = document.createElement('option');
      option.value = set.id;
      option.textContent = `${set.name}${set.publishedOn ? ' (' + set.publishedOn.split('T')[0] + ')' : ''}`;
      setSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load One Piece sets:', error);
    setSelect.innerHTML = '<option value="">Error loading sets</option>';
  }
}

// Handle set selection
async function handleOnePieceSetSelect(groupId) {
  if (!groupId) {
    displayedCards = [];
    renderCards();
    return;
  }
  
  try {
    showLoading(true);
    const cards = await getOnePieceSet(groupId);
    
    // Get the set name from the dropdown
    const setSelect = document.getElementById('onepiece-set-select');
    const setName = setSelect?.options[setSelect.selectedIndex]?.text || '';
    
    // Add set name to each card
    cards.forEach(card => {
      card.set = setName;
    });
    
    displayedCards = cards;
    renderCards();
  } catch (error) {
    console.error('Failed to load One Piece set:', error);
    alert('Failed to load set. Please try again.');
  } finally {
    showLoading(false);
  }
}

// Handle search
async function handleOnePieceSearch(query) {
  if (!query || query.trim().length < 2) {
    alert('Please enter at least 2 characters to search');
    return;
  }
  
  try {
    showLoading(true);
    const cards = await searchOnePiece(query);
    
    // Get set names for the cards
    const sets = await getOnePieceSets();
    const setMap = {};
    sets.forEach(s => {
      setMap[s.id] = s.name;
    });
    
    // Add set names to cards
    cards.forEach(card => {
      card.set = setMap[card.setGroupId] || '';
    });
    
    displayedCards = cards;
    renderCards();
    
    if (cards.length === 0) {
      alert('No cards found for that search');
    }
  } catch (error) {
    console.error('Failed to search One Piece cards:', error);
    alert('Search failed. Please try again.');
  } finally {
    showLoading(false);
  }
}

// ─────────────────────────────────────────────
// EVENT LISTENERS (add these to your init function)
// ─────────────────────────────────────────────

// Add these inside your game-specific initialization when One Piece is selected:
/*
document.getElementById('onepiece-set-select')?.addEventListener('change', (e) => {
  handleOnePieceSetSelect(e.target.value);
});

document.getElementById('onepiece-search-button')?.addEventListener('click', () => {
  const searchInput = document.getElementById('onepiece-search-input');
  if (searchInput) {
    handleOnePieceSearch(searchInput.value);
  }
});

document.getElementById('onepiece-search-input')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleOnePieceSearch(e.target.value);
  }
});

// Load sets when One Piece game is selected
loadOnePieceSets();
*/

// ═════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (make sure these exist in your main file)
// ═════════════════════════════════════════════════════════════════

function buildPriceMap(priceResults) {
  const map = {};
  priceResults.forEach(p => {
    if (!map[p.productId]) map[p.productId] = {};
    map[p.productId][p.subTypeName] = {
      low: p.lowPrice,
      mid: p.midPrice,
      high: p.highPrice,
      market: p.marketPrice,
      direct: p.directLowPrice,
    };
  });
  return map;
}

function parseExtendedData(extendedData) {
  const result = {};
  extendedData.forEach(item => {
    result[item.name] = item.value;
  });
  return result;
}

function isCard(product) {
  const ext = parseExtendedData(product.extendedData || []);
  return ext.Rarity || ext.Number || ext['Card Type'];
}

function sanitizeQuery(query) {
  return query.trim().replace(/[^\w\s-]/g, '');
}

function showLoading(show) {
  // Implement your loading indicator
  const loader = document.getElementById('loading-indicator');
  if (loader) {
    loader.style.display = show ? 'block' : 'none';
  }
}


  // ─────────────────────────────────────────────
  // INVINCIBLE TCG  (TCGCSV search + reference)
  // Invincible (Keepsake 2025) is a collectible
  // non-sport card set, not on TCGplayer as a TCG.
  // We search TCGCSV's non-sport categories as a
  // best-effort live lookup, then fall back to the
  // curated reference list for known cards.
  // ─────────────────────────────────────────────

  // Curated reference for the 2025 Keepsake Season 1 set
  // Values are approximate market prices at time of writing.
  const INVINCIBLE_SETS = [
    { id: 'inv-s1', name: 'Season 1 (2025 Keepsake)', releaseDate: '2025' },
  ];

  const INVINCIBLE_REFERENCE = [
    // Base cards
    { name: 'Invincible', number: '1',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 3.00 },
    { name: 'Omni-Man',   number: '2',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 3.00 },
    { name: 'Atom Eve',   number: '3',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.50 },
    { name: 'Rex Splode', number: '4',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.50 },
    { name: 'Robot',      number: '5',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.50 },
    { name: 'Dupli-Kate', number: '6',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.25 },
    { name: 'Monster Girl',   number: '7',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.25 },
    { name: 'Shrinking Rae',  number: '8',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.25 },
    { name: 'The Immortal',   number: '9',  set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.00 },
    { name: 'Black Samson',   number: '10', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.50 },
    { name: 'Allen the Alien', number: '11', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.50 },
    { name: 'Battle Beast',   number: '12', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 3.00 },
    { name: 'Cecil Stedman',  number: '13', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.50 },
    { name: 'Angstrom Levy',  number: '14', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.00 },
    { name: 'Conquest',       number: '15', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.00 },
    { name: 'Bulletproof',    number: '16', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.00 },
    { name: 'Thragg',         number: '17', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.50 },
    { name: 'The Mauler Twins', number: '18', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 2.00 },
    { name: 'The Flaxans',    number: '19', set: 'Season 1 (2025 Keepsake)', rarity: 'Base', estimatedValue: 1.25 },
    // Premium parallels (1st Edition Debut Premiere, Autographs, Relics have no fixed price list)
    { name: 'Invincible (Silver)',    number: '1',  set: 'Season 1 (2025 Keepsake)', rarity: 'Silver Parallel', estimatedValue: 12.00 },
    { name: 'Omni-Man (Silver)',      number: '2',  set: 'Season 1 (2025 Keepsake)', rarity: 'Silver Parallel', estimatedValue: 15.00 },
    { name: 'Atom Eve (Silver)',      number: '3',  set: 'Season 1 (2025 Keepsake)', rarity: 'Silver Parallel', estimatedValue: 10.00 },
    { name: 'Invincible (Gold)',      number: '1',  set: 'Season 1 (2025 Keepsake)', rarity: 'Gold Parallel',   estimatedValue: 40.00 },
    { name: 'Omni-Man (Gold)',        number: '2',  set: 'Season 1 (2025 Keepsake)', rarity: 'Gold Parallel',   estimatedValue: 55.00 },
    { name: 'Battle Beast (Gold)',    number: '12', set: 'Season 1 (2025 Keepsake)', rarity: 'Gold Parallel',   estimatedValue: 35.00 },
    { name: 'Thragg (Gold)',          number: '17', set: 'Season 1 (2025 Keepsake)', rarity: 'Gold Parallel',   estimatedValue: 45.00 },
    { name: 'Conquest (Gold)',        number: '15', set: 'Season 1 (2025 Keepsake)', rarity: 'Gold Parallel',   estimatedValue: 30.00 },
  ];

  function getInvincibleSets() {
    return INVINCIBLE_SETS;
  }

  function getInvincibleSet(setId) {
    // Only one set currently — return full reference list
    return INVINCIBLE_REFERENCE.map(mapInvincibleCard);
  }

  function searchInvincible(query) {
    const q = query.toLowerCase();
    return INVINCIBLE_REFERENCE
      .filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.set.toLowerCase().includes(q) ||
        c.rarity.toLowerCase().includes(q) ||
        c.number.includes(q)
      )
      .map(mapInvincibleCard);
  }

  function mapInvincibleCard(c) {
    return {
      apiId: `inv-${c.number}-${c.rarity.toLowerCase().replace(/\s+/g, '-')}`,
      name: c.name,
      set: c.set,
      number: c.number,
      rarity: c.rarity,
      imageUrl: '',   // No public image CDN available yet for Keepsake cards
      estimatedValue: c.estimatedValue,
      prices: { estimated: { market: c.estimatedValue, low: null, high: null } },
      note: 'Price is an estimate. No public live pricing API exists for this set.',
    };
  }

  function getBestInvinciblePrice(prices) {
    return prices?.estimated?.market ?? null;
  }


  // ─────────────────────────────────────────────
  // SHARED TCGCSV UTILITIES
  // ─────────────────────────────────────────────

  // Build a { productId: { VariantName: { market, low, mid, high } } } map
  function buildPriceMap(priceRows) {
    const map = {};
    for (const row of priceRows) {
      const id = row.productId;
      if (!map[id]) map[id] = {};
      const variant = row.subTypeName || 'Normal';
      map[id][variant] = {
        market: row.marketPrice ?? null,
        low: row.lowPrice ?? null,
        mid: row.midPrice ?? null,
        high: row.highPrice ?? null,
        directLow: row.directLowPrice ?? null,
      };
    }
    return map;
  }

  // Convert extendedData array → plain key/value object
  function parseExtendedData(extendedData) {
    const obj = {};
    for (const item of extendedData) {
      obj[item.name] = item.value;
    }
    return obj;
  }

  // Heuristic: a product is a card (not a booster/box) if it has Rarity or Number in extendedData
  function isCard(product) {
    const names = (product.extendedData || []).map(e => e.name);
    return names.includes('Rarity') || names.includes('Number');
  }


  // ─────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────
  function sanitizeQuery(str) {
    return str.replace(/[^\w\s\-'.]/g, '').trim();
  }


  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  return {
    // Pokemon
    searchPokemon,
    getPokemonSets,
    getPokemonSet,          // NEW — all cards in one set at once
    getBestPokemonPrice,
    mapPokemonCard,

    // One Piece
    searchOnePiece,
    getOnePieceSets,        // NEW — list all sets
    getOnePieceSet,         // NEW — all cards + prices for a set at once
    getBestOnePiecePrice,   // NEW

    // Invincible
    searchInvincible,
    getInvincibleSets,      // NEW — list known sets
    getInvincibleSet,       // NEW — all reference cards for a set
    getBestInvinciblePrice, // NEW

    // Utility
    sanitizeQuery,
    buildPriceMap,
    parseExtendedData,
  };
})();
