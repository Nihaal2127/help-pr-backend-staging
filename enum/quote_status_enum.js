const QuoteStatus = new Map([
    [1, "Pending"],
    [2, "Approved"],
    [3, "Rejected"],
    [4, "Converted"],
    [5, "Cancelled"],
    [6, "Expired"],
  ]);
  
  const getQuoteStatus = (key) => QuoteStatus.get(key) || "";
  const getQuoteStatusKey = (value) => {
    for (let [key, val] of QuoteStatus.entries()) {
      if (val === value) return key;
    }
    return null;
  };
  
  module.exports = {
    getQuoteStatus,
    getQuoteStatusKey,
  };
  