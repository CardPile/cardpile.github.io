$(async function ()
{
  const EXPANSION_DEFAULT_QUERY = "t:instant or kw:cycling or kw:flash";
  const EXPANSION_SPECIFIC_QUERY = {
    // "set": "query"
  };

  const EXPANSION_DEFAULT_PREDICATE = (card, face) => face.type_line.toLowerCase().includes("instant") ||
                                                      card.keywords.filter((kw) => kw.toLowerCase() === "flash").length > 0 ||
                                                      card.keywords.filter((kw) => kw.toLowerCase() === "cycling").length > 0;
  const EXPANSION_SPECIFIC_PREDICATE = {
    // "set": (card, face) => true
  };

  var currentExpansions = [];
  var currentCards = [];

  async function loadDataSetFromScryfall(uri)
  {
    var response = await fetch(uri);
    var cardsJson = await response.json();

    var data = cardsJson.data;
    while(cardsJson.has_more)
    {
      response = await fetch(cardsJson.next_page);
      cardsJson = await response.json();
      data.concat(cardsJson.data);
    }

    return data;
  }

  function getCyclingCost(oracleText)
  {
    const regex = /[A-Za-z]*[Cc]ycling[\s]+(?<cost>\{.*?\})[\s]+/;
    const matches = oracleText.match(regex);

    if(!matches)
    {
      return null;
    }
    if(matches.length < 2)
    {
      return null;
    }

    return matches[1];
  }

  function getCostReduction(oracleText)
  {
    const regex = /This spell costs[\s]+(?<cost>\{.*?\})[\s]+less to cast if/;
    const matches = oracleText.match(regex);

    if(!matches)
    {
      return "";
    }
    if(matches.length < 2)
    {
      return "";
    }

    return matches[1];
  }

  function getTotalCostReduction(oracleText)
  {
    const regex = /This spell costs[\s]+(?<cost>\{.*?\})[\s]+less to cast for each/;
    const matches = oracleText.match(regex);

    if(!matches)
    {
      return "";
    }
    if(matches.length < 2)
    {
      return "";
    }

    return matches[1];
  }

  function canSimpleCostBePaid(possibleCost, costReductions, totalCostReductions, total, w, u, b, r, g, c)
  {
    // Partial reductions
    for(const costReduction of costReductions)
    {
      if(costReduction === "W") { w += 1; total += 1; }
      if(costReduction === "U") { u += 1; total += 1; }
      if(costReduction === "B") { b += 1; total += 1; }
      if(costReduction === "R") { r += 1; total += 1; }
      if(costReduction === "G") { g += 1; total += 1; }
      if(costReduction === "C") { c += 1; total += 1; }

      const genericReduction = parseInt(costReduction);
      if(genericReduction)
      {
        total += genericReduction;
      }
    }

    // Total reductions
    for(const totalCostReduction of totalCostReductions)
    {
      if(totalCostReduction === "W") { w = Number.POSITIVE_INFINITY; total = Number.POSITIVE_INFINITY; }
      if(totalCostReduction === "U") { u = Number.POSITIVE_INFINITY; total = Number.POSITIVE_INFINITY; }
      if(totalCostReduction === "B") { b = Number.POSITIVE_INFINITY; total = Number.POSITIVE_INFINITY; }
      if(totalCostReduction === "R") { r = Number.POSITIVE_INFINITY; total = Number.POSITIVE_INFINITY; }
      if(totalCostReduction === "G") { g = Number.POSITIVE_INFINITY; total = Number.POSITIVE_INFINITY; }
      if(totalCostReduction === "C") { c = Number.POSITIVE_INFINITY; total = Number.POSITIVE_INFINITY; }

      const genericTotalReduction = parseInt(totalCostReduction);
      if(genericTotalReduction)
      {
        total = Number.POSITIVE_INFINITY;
      }
    }

    // Cost reductions
    for(const costPart of possibleCost)
    {
      if(costPart === "W") { w -= 1; total -= 1; }
      if(costPart === "U") { u -= 1; total -= 1; }
      if(costPart === "B") { b -= 1; total -= 1; }
      if(costPart === "R") { r -= 1; total -= 1; }
      if(costPart === "G") { g -= 1; total -= 1; }
      if(costPart === "C") { c -= 1; total -= 1; }

      const genericCost = parseInt(costPart);
      if(genericCost)
      {
        total -= genericCost;
      }

      if(w < 0) { return false; }
      if(u < 0) { return false; }
      if(b < 0) { return false; }
      if(r < 0) { return false; }
      if(g < 0) { return false; }
      if(c < 0) { return false; }
      if(total < 0) { return false; }
    }

    return true;
  }

  function generateSimpleCosts(manaCost)
  {
    const ZERO_CASTING_COST_SYMBOLS = ["{X}", "{W/P}", "{U/P}", "{B/P}", "{R/P}", "{G/P}", "{W/U/P}", "{W/B/P}", "{U/B/P}", "{U/R/P}", "{B/R/P}", "{B/G/P}", "{R/G/P}", "{R/W/P}", "{G/W/P}", "{G/U/P}"];
    const SNOW_MANA = "{S}";

    const cartesianProduct = (a) => a.reduce((a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())));

    const regex = /\{(.*?)\}/g;
    const matches = manaCost.match(regex);

    if(!matches)
    {
      return [];
    }

    var parts = [];
    for (const match of matches)
    {
      if(ZERO_CASTING_COST_SYMBOLS.includes(match))
      {
        continue;
      }

      if(matches === SNOW_MANA)
      {
        // Fake snow mana as generic mana
        parts.push("{1}");
        continue;
      }

      const innerCost = match.slice(1,-1);
      const innerCostParts = innerCost.split("/");
      parts.push(innerCostParts);
    }

    return cartesianProduct(parts);
  }

  function generateSimpleCostReduction(costReduction)
  {
    const regex = /\{(.*?)\}/g;
    const matches = costReduction.match(regex);

    if(!matches)
    {
      return [];
    }

    return matches;
  }

  function generateCardData(searchResult)
  {
    const predicate = (searchResult.set in EXPANSION_SPECIFIC_PREDICATE ? EXPANSION_SPECIFIC_PREDICATE[searchResult.set] : EXPANSION_DEFAULT_PREDICATE);

    var result = [];

    if(searchResult.card_faces)
    {
      // Double-sided card or a single-sided card with multiple-modes
      for (const face of searchResult.card_faces)
      {
        if(predicate(searchResult, face))
        {
          result.push({
            name: face.name,
            image: (face.image_uris ? face.image_uris.normal : searchResult.image_uris.normal),
            mana_cost: face.mana_cost,
            colors: (face.colors ? face.colors : searchResult.colors),
            type_line: face.type_line,
            oracle_text: face.oracle_text,
            cycling_cost: getCyclingCost(face.oracle_text),
            cost_reduction: getCostReduction(face.oracle_text),
            total_cost_reduction: getTotalCostReduction(face.oracle_text),
            keywords: searchResult.keywords,
            collector_number: searchResult.collector_number,
            cmc: searchResult.cmc
          });
        }
      }
    }
    else
    {
      // Single-sided card
      result.push({
        name: searchResult.name,
        image: searchResult.image_uris.normal,
        mana_cost: searchResult.mana_cost,
        colors: searchResult.colors,
        type_line: searchResult.type_line,
        oracle_text: searchResult.oracle_text,
        cycling_cost: getCyclingCost(searchResult.oracle_text),
        cost_reduction: getCostReduction(searchResult.oracle_text),
        total_cost_reduction: getTotalCostReduction(searchResult.oracle_text),
        keywords: searchResult.keywords,
        collector_number: searchResult.collector_number,
        cmc: searchResult.cmc
      });
    }

    return result;
  }

  function canBeCast(card, total, w, u, b, r, g, c)
  {
    if(!card.type_line.toLowerCase().includes("instant") && !card.oracle_text.toLowerCase().includes("flash"))
    {
      return false;
    }

    const manaCost = card.mana_cost;
    if(!manaCost)
    {
      return false;
    }

    const simpleReductions = generateSimpleCostReduction(card.cost_reduction).map((x) => x.slice(1,-1));
    const simpleTotalReductions = [... new Set(generateSimpleCostReduction(card.total_cost_reduction).map((x) => (parseInt(x.slice(1,-1)) ? "1" : x.slice(1,-1))))];

    const simpleCosts = generateSimpleCosts(manaCost);
    for(const simpleCost of simpleCosts)
    {
      if(canSimpleCostBePaid(simpleCost, simpleReductions, simpleTotalReductions, total, w, u, b, r, g, c))
      {
        return true;
      }
    }

    return false;
  }

  function canBeCycled(card, total, w, u, b, r, g, c)
  {
    const cyclingCost = card.cycling_cost;
    if(!cyclingCost)
    {
      return false;
    }

    const simpleCosts = generateSimpleCosts(cyclingCost);
    for(const simpleCost of simpleCosts)
    {
      if(canSimpleCostBePaid(simpleCost, [], [], total, w, u, b, r, g, c))
      {
        return true;
      }
    }

    return false;
  }

  function cardSort(cardA, cardB)
  {
    const standardCardSort = (lhs, rhs) =>
    {
      const lhsCmc = lhs.cmc;
      const rhsCms = rhs.cmc;
      if(lhsCmc !== rhsCms)
      {
        return lhsCmc - rhsCms;
      }

      return lhs.collector_number - rhs.collector_number;
    };

    const colorOrder = (color) =>
    {
      return ({
        "W": 0,
        "U": 1,
        "B": 2,
        "R": 3,
        "G": 4
      })[color] || 0;
    };

    const colorCountA = cardA.colors.length;
    const colorCountB = cardB.colors.length;
    if(colorCountA !== colorCountB)
    {
      const colorCountOrderA = (colorCountA === 1 ? 0 : (colorCountA > 1 ? 1 : 2));
      const colorCountOrderB = (colorCountB === 1 ? 0 : (colorCountB > 1 ? 1 : 2));
      if(colorCountOrderA !== colorCountOrderB)
      {
        return colorCountOrderA - colorCountOrderB;
      }

      return standardCardSort(cardA, cardB);
    }

    if(colorCountA !== 1)
    {
      return standardCardSort(cardA, cardB);
    }

    // Just one color now
    const colorOrderA = colorOrder(cardA.colors[0]);
    const colorOrderB = colorOrder(cardB.colors[0]);
    if(colorOrderA !== colorOrderB)
    {
      return colorOrderA - colorOrderB;
    }

    return standardCardSort(cardA, cardB);
  }

  function showAllToggled()
  {
    const checked = $("#showAll").is(":checked")

    if(checked)
    {
      $("#manaTotal").attr("disabled", "true");
      $("#manaWhite").attr("disabled", "true");
      $("#manaBlue").attr("disabled", "true");
      $("#manaBlack").attr("disabled", "true");
      $("#manaRed").attr("disabled", "true");
      $("#manaGreen").attr("disabled", "true");
      $("#manaColorless").attr("disabled", "true");
    }
    else
    {
      $("#manaTotal").removeAttr("disabled");
      $("#manaWhite").removeAttr("disabled");
      $("#manaBlue").removeAttr("disabled");
      $("#manaBlack").removeAttr("disabled");
      $("#manaRed").removeAttr("disabled");
      $("#manaGreen").removeAttr("disabled");
      $("#manaColorless").removeAttr("disabled");
    }

    filterCards();
  }

  function filterCards()
  {
    try
    {
      const total = parseInt($("#manaTotal").val());
      const w = parseInt($("#manaWhite").val());
      const u = parseInt($("#manaBlue").val());
      const b = parseInt($("#manaBlack").val());
      const r = parseInt($("#manaRed").val());
      const g = parseInt($("#manaGreen").val());
      const c = parseInt($("#manaColorless").val());
      const showAll = $("#showAll").is(":checked") || total + w + u + b + r + g + c === 0;

      var filteredCards = []
      if(!showAll)
      {
        const derivedTotal = (total > 0 ? total : w + u + b + r + g + c);
        var filteredCards = currentCards.map((card) => generateCardData(card))
                                        .reduce((acc, val) => acc.concat(val), [])
                                        .filter((card) => canBeCast(card, derivedTotal, w, u, b, r, g, c) || canBeCycled(card, derivedTotal, w, u, b, r, g, c))
                                        .filter((card, pos, self) => self.findIndex((c) => c.collector_number === card.collector_number) === pos)
                                        .sort(cardSort);
      }
      else
      {
        var filteredCards = currentCards.map((card) => generateCardData(card))
                                        .reduce((acc, val) => acc.concat(val), [])
                                        .filter((card, pos, self) => self.findIndex((c) => c.collector_number === card.collector_number) === pos)
                                        .sort(cardSort);
      }

      $("#cards").empty();
      for (const currentCard of filteredCards)
      {
        const newCardImg = $("<img>").attr("src", currentCard.image)
                                     .attr("alt", currentCard.name)
                                     .attr("class", "img-fluid m-1 rounded")
                                     .attr("style", "width: 12vw; min-width: 125px; height: auto;");
        $("#cards").append(newCardImg);
      }

      $("#resultCount").text(filteredCards.length + " out of " + currentCards.length);
    }
    catch (e)
    {
      alert("Error filtering cards: " + e);
    }
  }

  async function loadCards(set)
  {
    try
    {
      $("#currentSet").text(set.name);

      const setCode = set.code;
      const searchQuery = "set:" + setCode + " and (" + (setCode in EXPANSION_SPECIFIC_QUERY ? EXPANSION_SPECIFIC_QUERY[setCode] : EXPANSION_DEFAULT_QUERY) + ")";
      const searchQueryEncoded = encodeURI(searchQuery)
      currentCards = await loadDataSetFromScryfall("https://api.scryfall.com/cards/search?q=" + searchQueryEncoded);
    }
    catch (e)
    {
      alert("Error loading cards: " + e);
    }

    filterCards();
  }

  async function loadExpansions()
  {
    try
    {
      const setsJson = await loadDataSetFromScryfall("https://api.scryfall.com/sets");
      const today = new Date();

      currentExpansions = setsJson.filter((set) => set.set_type === "expansion" && new Date(set.released_at).getTime() <= today.getTime() ).sort((s1, s2) => { s1d = new Date(s1.released_at).getTime(); s2d = new Date(s1.released_at).getTime(); return (s1d < s2d ? -1 : (s1d > s2d ? 1 : 0)); });

      $("#setList").empty();
      for (const currentExpansion of currentExpansions)
      {
        const newSetAnchor = $("<a>").attr("href", "#")
                                     .attr("class", "dropdown-item")
                                     .text(currentExpansion.name);

        newSetAnchor.click(function(){ loadCards(currentExpansion); });

        const newSetLi = $("<li>").append(newSetAnchor);

        $("#setList").append(newSetLi);
      }
    }
    catch (e)
    {
      alert("Error loading sets: " + e);
      return;
    }

    await loadCards(currentExpansions[0]);
  }

  await loadExpansions();

  $("#manaTotal").change(filterCards);
  $("#manaWhite").change(filterCards);
  $("#manaBlue").change(filterCards);
  $("#manaBlack").change(filterCards);
  $("#manaRed").change(filterCards);
  $("#manaGreen").change(filterCards);
  $("#manaColorless").change(filterCards);
  $("#showAll").change(showAllToggled);
});
