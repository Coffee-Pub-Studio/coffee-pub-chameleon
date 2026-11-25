
  // Budget's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One
  // copy of each rule, run on the page (host.actions.fromLibrary, budget.js) and by the
  // server's runner (server/module-actions.js). No page in it: each handler reads the costs through `ctx` and answers what to
  // write. A throw is the refusal; its message is the sentence the asker reads. It expects budget-lib.js in scope.
  //
  // Beside the runner's ctx it reads `ctx.settings.categories`, the environment's list of categories as host.settings.get()
  // gives it: a cost keeps its category's words (`categoryName`) for the other modules that show it. The page hands it
  // (budget.js) and the server's runner gives it too. Amounts are in the space's one currency (its budget's): a cost has none of its own.
  const BudgetActions = (() => {
    const has = (x) => x !== undefined && x !== null;
    const refOf = (ctx, id) => ({ module: 'budget', kind: 'cost', id, scope: 'space', space: ctx.space.id });
    const catsOf = (ctx) => cleanCategories(ctx.settings && typeof ctx.settings === 'object' ? ctx.settings.categories : null);
    // What is stored for a cost, named by its category's words now (budget.js saveCost).
    const valueOf = (c, ctx) => costValue(c, catRow(catsOf(ctx), c.category).label);
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
    const AMOUNT = (what) => `The ${what} is a number above zero, such as 40 or 12.50.`;

    const handlers = {
      // A cost as another module or an agent asks for it (costFromRequest in budget-lib.js), credited to the asker's key.
      addCost(input, ctx) {
        const c = costFromRequest(input, ctx.credit.key, ctx.people, ctx.util.word('space'));
        const id = ctx.util.id();
        return { writes: [{ key: COST_PREFIX + id, value: valueOf(c, ctx) }], ref: refOf(ctx, id) };
      },
      // Change a cost: only the fields given, with the form's own checks and sentences. `amount` is the paid amount when the
      // cost has a payer or is paid, else the planned one, as addCost reads it. An input sent as "" (the manifest's `clears`:
      // planned, actual, payer, sharedBy, date, notes) clears it, as emptying it in the form does. Who added it stays.
      updateCost(input, ctx) {
        const ref = input.cost;
        const ours = Boolean(ref && typeof ref === 'object' && ref.module === 'budget' && ref.kind === 'cost' && typeof ref.id === 'string' && ref.scope === 'space' && ref.space === ctx.space.id);
        const stored = ours ? ctx.read(COST_PREFIX + ref.id) : null;
        const cur = stored ? cleanCost(ref.id, stored) : null;
        if (!cur) throw new Error("That cost isn't in the budget.");
        const fields = ['title', 'amount', 'planned', 'actual', 'category', 'payer', 'sharedBy', 'date', 'notes'];
        if (!fields.some((f) => has(input[f]))) throw new Error('Say what to change: the title, an amount, planned, actual, the category, who paid, who shares it, the date or the notes. Send "" to clear any but the title, amount and category.');
        if (has(input.amount) && (has(input.planned) || has(input.actual))) throw new Error('Give amount, or planned and actual, not both.');
        const where = ctx.util.word('space');
        const next = { ...cur };
        if (has(input.title)) {
          next.title = oneLine(input.title, 120);
          if (!next.title) throw new Error('Give the cost a title.');
        }
        const amountOfInput = (v, what) => {
          if (v === '') return null;
          const a = typeof v === 'boolean' ? null : cleanAmount(v);
          if (a === null) throw new Error(AMOUNT(what));
          return a;
        };
        if (has(input.planned)) next.planned = amountOfInput(input.planned, 'planned amount');
        if (has(input.actual)) next.actual = amountOfInput(input.actual, 'paid amount');
        if (has(input.payer)) next.paidBy = input.payer === '' ? '' : personKey(input.payer, ctx.people, where);
        if (has(input.sharedBy)) next.sharedBy = input.sharedBy === '' ? [] : [...new Set(sharersOf(input.sharedBy, ctx.people, where))];
        if (has(input.amount)) {
          const a = cleanAmount(input.amount);
          if (a === null || typeof input.amount === 'boolean') throw new Error(AMOUNT('amount'));
          if (next.paidBy || cur.actual) next.actual = a; else next.planned = a;
        }
        if (has(input.category)) next.category = String(input.category);
        if (has(input.date)) {
          if (input.date !== '' && !isDay(input.date)) throw new Error('The date is a day, such as 2026-10-14.');
          next.date = input.date;
        }
        if (has(input.notes)) next.notes = String(input.notes);
        const value = valueOf(cleanCost(ref.id, next), ctx);
        if (canon(value) === canon(stored)) return { ref: refOf(ctx, ref.id), data: { note: 'That is already so; nothing changed.' } };
        return { writes: [{ key: COST_PREFIX + ref.id, value }], ref: refOf(ctx, ref.id) };
      },
    };
    return { handlers };
  })();
  const ACTION_HANDLERS = BudgetActions.handlers;
