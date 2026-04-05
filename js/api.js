/**
 * API module - handles card lookups using public APIs.
 *
 * Pokemon TCG: https://api.pokemontcg.io/v2 (free, no key required)
 * One Piece TCG: Uses a public fan API for card data
 * Invincible TCG: Manual entry (no public API yet - very new product)
 */

const CardAPI = (() => {
  // --- Pokemon TCG API ---
  const POKEMON_API_BASE = 'https://api.pokemontcg.io/v2';

  async function searchPokemon(query, setId = '') {
    let searchQuery = `name:"${sanitizeQuery(query)}*"`;
    if (setId) {
      searchQuery += ` set.id:${sanitizeQuery(setId)}`;
    }

    const url = `${POKEMON_API_BASE}/cards?q=${encodeURIComponent(searchQuery)}&pageSize=20&orderBy=-set.releaseDate`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Pokemon API request failed');

    const data = await response.json();
    return (data.data || []).map(card => ({
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
      prices: extractPokemonPrices(card),
    }));
  }

  function extractPokemonPrices(card) {
    const prices = {};
    if (card.tcgplayer && card.tcgplayer.prices) {
      const p = card.tcgplayer.prices;
      for (const variant of Object.keys(p)) {
        if (p[variant].market) {
          prices[variant] = {
            market: p[variant].market,
            low: p[variant].low || null,
            mid: p[variant].mid || null,
            high: p[variant].high || null,
          };
        }
      }
    }
    if (card.cardmarket && card.cardmarket.prices) {
      prices.cardmarket = {
        averageSellPrice: card.cardmarket.prices.averageSellPrice || null,
        trendPrice: card.cardmarket.prices.trendPrice || null,
      };
    }
    return prices;
  }

  async function getPokemonSets() {
    const url = `${POKEMON_API_BASE}/sets?orderBy=-releaseDate&pageSize=50`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch Pokemon sets');
    const data = await response.json();
    return (data.data || []).map(s => ({ id: s.id, name: s.name, series: s.series }));
  }

  function getBestPokemonPrice(prices) {
    if (!prices) return null;
    for (const variant of Object.keys(prices)) {
      if (variant === 'cardmarket') continue;
      if (prices[variant] && prices[variant].market) {
        return prices[variant].market;
      }
    }
    if (prices.cardmarket && prices.cardmarket.trendPrice) {
      return prices.cardmarket.trendPrice;
    }
    return null;
  }

  // --- One Piece TCG ---
  // Using the public One Piece TCG API
  const ONEPIECE_API_BASE = 'https://apitcg.com/api/one-piece';

  async function searchOnePiece(query) {
    const url = `${ONEPIECE_API_BASE}/cards?name=${encodeURIComponent(sanitizeQuery(query))}&limit=20`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('One Piece API request failed');
      const data = await response.json();
      const cards = data.cards || data.data || data || [];
      return (Array.isArray(cards) ? cards : []).map(card => ({
        apiId: card.id || card.code || '',
        name: card.name || card.title || '',
        set: card.set || card.pack || card.booster || '',
        number: card.code || card.number || card.id || '',
        rarity: card.rarity || '',
        imageUrl: card.image || card.imageUrl || card.img || '',
        color: card.color || '',
        type: card.type || card.category || '',
        cost: card.cost || card.life || '',
        power: card.power || '',
        effect: card.effect || card.text || '',
        prices: {},
      }));
    } catch {
      // Fallback: return empty if API is unavailable
      return [];
    }
  }

  // --- Invincible TCG ---
  // No established public API yet - this is a very new product line.
  // We provide a curated reference list and manual entry.

  const INVINCIBLE_REFERENCE = [
    { name: 'Mark Grayson / Invincible', set: 'Series 1', rarity: 'Ultra Rare', estimatedValue: 45.00, imageUrl: '' },
    { name: 'Omni-Man', set: 'Series 1', rarity: 'Ultra Rare', estimatedValue: 55.00, imageUrl: '' },
    { name: 'Atom Eve', set: 'Series 1', rarity: 'Rare', estimatedValue: 15.00, imageUrl: '' },
    { name: 'Rex Splode', set: 'Series 1', rarity: 'Rare', estimatedValue: 8.00, imageUrl: '' },
    { name: 'Robot', set: 'Series 1', rarity: 'Rare', estimatedValue: 10.00, imageUrl: '' },
    { name: 'Allen the Alien', set: 'Series 1', rarity: 'Uncommon', estimatedValue: 5.00, imageUrl: '' },
    { name: 'Cecil Stedman', set: 'Series 1', rarity: 'Uncommon', estimatedValue: 4.00, imageUrl: '' },
    { name: 'Battle Beast', set: 'Series 1', rarity: 'Ultra Rare', estimatedValue: 40.00, imageUrl: '' },
    { name: 'Conquest', set: 'Series 1', rarity: 'Secret Rare', estimatedValue: 75.00, imageUrl: '' },
    { name: 'Angstrom Levy', set: 'Series 1', rarity: 'Rare', estimatedValue: 12.00, imageUrl: '' },
    { name: 'Dupli-Kate', set: 'Series 1', rarity: 'Common', estimatedValue: 2.00, imageUrl: '' },
    { name: 'Shrinking Rae', set: 'Series 1', rarity: 'Common', estimatedValue: 2.00, imageUrl: '' },
    { name: 'Monster Girl', set: 'Series 1', rarity: 'Uncommon', estimatedValue: 4.50, imageUrl: '' },
    { name: 'Thragg', set: 'Series 1', rarity: 'Secret Rare', estimatedValue: 85.00, imageUrl: '' },
    { name: 'Bulletproof', set: 'Series 1', rarity: 'Common', estimatedValue: 1.50, imageUrl: '' },
  ];

  function searchInvincible(query) {
    const q = query.toLowerCase();
    return INVINCIBLE_REFERENCE.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.set.toLowerCase().includes(q) ||
      c.rarity.toLowerCase().includes(q)
    ).map(c => ({
      apiId: 'inv-' + c.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      name: c.name,
      set: c.set,
      number: '',
      rarity: c.rarity,
      imageUrl: c.imageUrl,
      estimatedValue: c.estimatedValue,
      prices: { estimated: { market: c.estimatedValue } },
    }));
  }

  // --- Utility ---
  function sanitizeQuery(str) {
    // Remove characters that could break API queries
    return str.replace(/[^\w\s\-'.]/g, '').trim();
  }

  return {
    searchPokemon,
    getPokemonSets,
    getBestPokemonPrice,
    searchOnePiece,
    searchInvincible,
    sanitizeQuery,
  };
})();
