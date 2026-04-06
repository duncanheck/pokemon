/**
 * API v2.0 - Card Lookup Module
 * 
 * Supported Games:
 * - Pokémon TCG     → pokemontcg.io (free, reliable)
 * - One Piece TCG   → TCGCSV (TCGplayer proxy) + fallback ready
 * - Invincible TCG  → Curated reference (no public live API yet)
 */

const CardAPI = (() => {

  // ─────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────
  const POKEMON_API_BASE = 'https://api.pokemontcg.io/v2';
  const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
  const ONEPIECE_CATEGORY = 68;

  // ─────────────────────────────────────────────
  // SHARED UTILITIES
  // ─────────────────────────────────────────────
  function sanitizeQuery(str) {
    return (str || '').toString().trim().replace(/[^\w\s\-'.]/g, '');
  }

  function showLoading(show) {
    const loader = document.getElementById('loading-indicator');
    if (loader) loader.style.display = show ? 'block' : 'none';
  }

  async function safeFetch(url, errorMsg) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`Fetch failed: ${url} → ${response.status}`, text);
        throw new Error(`${errorMsg} (${response.status})`);
      }
      return await response.json();
    } catch (err) {
      console.error(`Error fetching ${url}:`, err);
      throw err;
    }
  }

  // ─────────────────────────────────────────────
  // POKÉMON TCG
  // ─────────────────────────────────────────────
  async function searchPokemon(query, setId = '') {
    let q = `name:"${sanitizeQuery(query)}*"`;
    if (setId) q += ` set.id:${sanitizeQuery(setId)}`;

    const url = `${POKEMON_API_BASE}/cards?q=${encodeURIComponent(q)}&pageSize=20&orderBy=-set.releaseDate`;
    const data = await safeFetch(url, 'Pokémon API request failed');
    return (data.data || []).map(mapPokemonCard);
  }

  async function getPokemonSet(setId) {
    if (!setId) throw new Error('setId is required');
    const baseUrl = `${POKEMON_API_BASE}/cards?q=set.id:${sanitizeQuery(setId)}&orderBy=number`;

    let cards = [];
    let page = 1;
    let total = 0;

    do {
      const url = `${baseUrl}&pageSize=250&page=${page}`;
      const data = await safeFetch(url, `Failed to fetch Pokémon set ${setId}`);
      
      cards.push(...(data.data || []));
      total = data.totalCount || cards.length;
      page++;
    } while (cards.length < total);

    return cards.map(mapPokemonCard);
  }

  async function getPokemonSets() {
    const url = `${POKEMON_API_BASE}/sets?orderBy=-releaseDate&pageSize=250`;
    const data = await safeFetch(url, 'Failed to fetch Pokémon sets');
    return (data.data || []).map(s => ({
      id: s.id,
      name: s.name,
      series: s.series,
      total: s.total,
      releaseDate: s.releaseDate,
      symbolUrl: s.images?.symbol || '',
      logoUrl: s.images?.logo || '',
    }));
  }

  function mapPokemonCard(card) {
    return {
      apiId: card.id,
      name: card.name || '',
      set: card.set?.name || '',
      setId: card.set?.id || '',
      number: card.number || '',
      rarity: card.rarity || '',
      imageUrl: card.images?.small || '',
      imageLarge: card.images?.large || '',
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
    if (card.tcgplayer?.prices) {
      Object.keys(card.tcgplayer.prices).forEach(variant => {
        const p = card.tcgplayer.prices[variant];
        if (p?.market != null) {
          prices[variant] = {
            market: p.market,
            low: p.low ?? null,
            mid: p.mid ?? null,
            high: p.high ?? null,
          };
        }
      });
    }
    if (card.cardmarket?.prices) {
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

  // ─────────────────────────────────────────────
  // ONE PIECE TCG (TCGCSV)
  // ─────────────────────────────────────────────
  async function getOnePieceSets() {
    const url = `${TCGCSV_BASE}/${ONEPIECE_CATEGORY}/groups`;
    const data = await safeFetch(url, 'Failed to fetch One Piece sets');
    return (data.results || []).map(g => ({
      id: g.groupId,
      name: g.name || '',
      abbreviation: g.abbreviation || '',
      publishedOn: g.publishedOn || '',
    }));
  }

  async function getOnePieceSet(groupId) {
    if (!groupId) throw new Error('groupId is required');

    const [productsRes, pricesRes] = await Promise.all([
      safeFetch(`${TCGCSV_BASE}/${ONEPIECE_CATEGORY}/${groupId}/products`, `Failed to fetch One Piece products for group ${groupId}`),
      safeFetch(`${TCGCSV_BASE}/${ONEPIECE_CATEGORY}/${groupId}/prices`, `Failed to fetch One Piece prices for group ${groupId}`)
    ]);

    const priceMap = buildPriceMap(pricesRes.results || []);
    const cards = (productsRes.results || []).filter(isCard);

    return cards.map(p => mapOnePieceProduct(p, priceMap));
  }

  async function searchOnePiece(query) {
    if (!query || query.trim().length < 2) return [];
    const q = sanitizeQuery(query).toLowerCase();

    const sets = await getOnePieceSets();
    const recentSets = sets.slice(0, 8); // Search newest 8 sets for speed

    const results = await Promise.all(
      recentSets.map(s => getOnePieceSet(s.id).catch(() => []))
    );

    return results.flat().filter(c =>
      c.name.toLowerCase().includes(q) || 
      (c.number && c.number.toLowerCase().includes(q))
    );
  }

  function mapOnePieceProduct(product, priceMap) {
    const ext = parseExtendedData(product.extendedData || []);
    const prices = priceMap[product.productId] || {};

    return {
      apiId: String(product.productId),
      name: product.name || '',
      set: '',                    // Filled by caller
      setGroupId: product.groupId,
      number: ext.Number || '',
      rarity: ext.Rarity || '',
      imageUrl: product.imageUrl ? product.imageUrl.replace('_200w.jpg', '_400w.jpg') : '',
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
    const order = ['Normal', 'Holofoil', ...Object.keys(prices)];
    for (const variant of order) {
      if (prices[variant]?.market != null) return prices[variant].market;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // INVINCIBLE TCG (Curated Reference)
  // ─────────────────────────────────────────────
  const INVINCIBLE_REFERENCE = [ /* ... your full list from v1 ... */ ];

  function getInvincibleSets() {
    return [{ id: 'inv-s1', name: 'Season 1 (2025 Keepsake)', releaseDate: '2025' }];
  }

  function getInvincibleSet(setId) {
    return INVINCIBLE_REFERENCE.map(mapInvincibleCard);
  }

  function searchInvincible(query) {
    const q = (query || '').toLowerCase();
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
      imageUrl: '',
      estimatedValue: c.estimatedValue,
      prices: { estimated: { market: c.estimatedValue } },
      note: 'Estimated price only. No live TCGplayer data available yet.',
    };
  }

  function getBestInvinciblePrice(prices) {
    return prices?.estimated?.market ?? null;
  }

  // ─────────────────────────────────────────────
  // TCGCSV HELPERS (shared)
  // ─────────────────────────────────────────────
  function buildPriceMap(priceResults) {
    const map = {};
    for (const p of priceResults || []) {
      if (!map[p.productId]) map[p.productId] = {};
      const variant = p.subTypeName || 'Normal';
      map[p.productId][variant] = {
        market: p.marketPrice ?? null,
        low: p.lowPrice ?? null,
        mid: p.midPrice ?? null,
        high: p.highPrice ?? null,
        directLow: p.directLowPrice ?? null,
      };
    }
    return map;
  }

  function parseExtendedData(extendedData) {
    const obj = {};
    for (const item of extendedData || []) {
      obj[item.name] = item.value;
    }
    return obj;
  }

  function isCard(product) {
    const ext = parseExtendedData(product.extendedData || []);
    return !!(ext.Rarity || ext.Number || ext['Card Type']);
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  return {
    // Pokémon
    searchPokemon,
    getPokemonSets,
    getPokemonSet,
    getBestPokemonPrice,

    // One Piece
    getOnePieceSets,
    getOnePieceSet,
    searchOnePiece,
    getBestOnePiecePrice,

    // Invincible
    getInvincibleSets,
    getInvincibleSet,
    searchInvincible,
    getBestInvinciblePrice,

    // Utilities
    sanitizeQuery,
    showLoading,
  };
})();
