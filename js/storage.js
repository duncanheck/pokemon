/**
 * Storage module - handles all localStorage operations for the card collection.
 * Data is stored per-category with unique IDs.
 */

const Storage = (() => {
  const STORAGE_KEY = 'cardvault_collection';

  function getAll() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : { pokemon: [], onepiece: [], invincible: [] };
    } catch {
      return { pokemon: [], onepiece: [], invincible: [] };
    }
  }

  function saveAll(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  function addCard(category, card) {
    const data = getAll();
    if (!data[category]) data[category] = [];
    card.id = generateId();
    card.addedAt = new Date().toISOString();
    data[category].push(card);
    saveAll(data);
    return card;
  }

  function updateCard(category, cardId, updates) {
    const data = getAll();
    const list = data[category] || [];
    const index = list.findIndex(c => c.id === cardId);
    if (index === -1) return null;
    Object.assign(list[index], updates);
    list[index].updatedAt = new Date().toISOString();
    saveAll(data);
    return list[index];
  }

  function deleteCard(category, cardId) {
    const data = getAll();
    const list = data[category] || [];
    const index = list.findIndex(c => c.id === cardId);
    if (index === -1) return false;
    list.splice(index, 1);
    saveAll(data);
    return true;
  }

  function getCollection(category) {
    const data = getAll();
    return data[category] || [];
  }

  function getCategoryStats(category) {
    const cards = getCollection(category);
    const totalValue = cards.reduce((sum, c) => sum + (parseFloat(c.value) || 0) * (parseInt(c.quantity) || 1), 0);
    const totalCost = cards.reduce((sum, c) => sum + (parseFloat(c.purchasePrice) || 0) * (parseInt(c.quantity) || 1), 0);
    const totalCards = cards.reduce((sum, c) => sum + (parseInt(c.quantity) || 1), 0);
    return { totalValue, totalCost, totalCards, profit: totalValue - totalCost };
  }

  function getAllStats() {
    const categories = ['pokemon', 'onepiece', 'invincible'];
    const stats = {};
    let grandTotalValue = 0;
    let grandTotalCost = 0;
    let grandTotalCards = 0;

    for (const cat of categories) {
      stats[cat] = getCategoryStats(cat);
      grandTotalValue += stats[cat].totalValue;
      grandTotalCost += stats[cat].totalCost;
      grandTotalCards += stats[cat].totalCards;
    }

    stats.total = {
      totalValue: grandTotalValue,
      totalCost: grandTotalCost,
      totalCards: grandTotalCards,
      profit: grandTotalValue - grandTotalCost
    };

    return stats;
  }

  function getTopCards(limit = 5) {
    const data = getAll();
    const allCards = [];
    for (const cat of ['pokemon', 'onepiece', 'invincible']) {
      for (const card of (data[cat] || [])) {
        allCards.push({ ...card, category: cat });
      }
    }
    allCards.sort((a, b) => ((parseFloat(b.value) || 0) * (parseInt(b.quantity) || 1)) -
                            ((parseFloat(a.value) || 0) * (parseInt(a.quantity) || 1)));
    return allCards.slice(0, limit);
  }

  function getRecentCards(limit = 10) {
    const data = getAll();
    const allCards = [];
    for (const cat of ['pokemon', 'onepiece', 'invincible']) {
      for (const card of (data[cat] || [])) {
        allCards.push({ ...card, category: cat });
      }
    }
    allCards.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    return allCards.slice(0, limit);
  }

  function exportData() {
    return JSON.stringify(getAll(), null, 2);
  }

  function importData(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data.pokemon || !data.onepiece || !data.invincible) {
      throw new Error('Invalid data format');
    }
    saveAll(data);
    return true;
  }

  return {
    getAll,
    addCard,
    updateCard,
    deleteCard,
    getCollection,
    getCategoryStats,
    getAllStats,
    getTopCards,
    getRecentCards,
    exportData,
    importData
  };
})();
