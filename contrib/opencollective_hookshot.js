// Input is data object which is hook body
// Output is result variable of form
// {
//     "version": "v2" // The version of the schema being returned from the function. This is always "v2".
//     "empty": true|false, // Should the webhook be ignored and no output returned. The default is false (plain must be provided).
//     "plain": "Some text", // The plaintext value to be used for the Matrix message.
//     "html": "<b>Some</b> text", // The HTML value to be used for the Matrix message. If not provided, plain will be interpreted as markdown.
//     "msgtype": "some.type", // The message type, such as m.notice or m.text, to be used for the Matrix message. If not provided, m.notice will be used.
// }

// Configure this for the collective you are receiving webhooks from.
// Expense payloads (unlike transactions) don't have this in the data.
const defaultCollective = {
    slug: "sunpy",
    name: "SunPy"
};

const expenseNameBy = function(expense, user) {
    return `${expense.description} for ${expense.formattedAmount} by ${user.name}`;
};

const expenseNameByHtml = function(expense, user) {
    return `<a href="https://opencollective.com/${defaultCollective.slug}/expenses/${expense.id}">${expense.description}</a> for <b>${expense.formattedAmount}</b> by <a href="https://opencollective.com/${user.slug}">${user.name}</a>`;
};

const collectiveExpenseAction = function(expense, user, verb) {
    return {
        plain: `Expense ${verb}: ${expenseNameBy(expense, user)}`,
        html: `<b>Expense ${verb}</b>: ${expenseNameByHtml(expense, user)}`
    };
};

const expenseVerbs = {
    "collective.expense.created": "Created",
    "collective.expense.approved": "Approved",
    "collective.expense.paid": "Paid",
    // This is a guess. I haven't rejected an expense yet.
    "collective.expense.rejected": "Rejected"
};

const capitalise = function(string) {
    return string.slice(0,1).toUpperCase() + string.slice(1).toLowerCase();
};

// Handle collective.expense
if (data.type in expenseVerbs) {
    const expense = data.data.expense;
    const user = data.data.fromCollective;
    result = collectiveExpenseAction(expense, user, expenseVerbs[data.type]);

    // Make a new expense generate a notification
    if (data.type == "collective.expense.created") {
        result = {msgtype: "m.text", ...result};
    };

} else if (data.type == "collective.transaction.created") {
    const transaction = data.data.transaction;
    const user = data.data.fromCollective;
    const destination = data.data.collective;
    result = {
        plain: `${capitalise(transaction.type)} from ${user.name} to ${destination.name} for ${transaction.formattedAmount}: ${transaction.description}`,
        html: `${capitalise(transaction.type)} from ${user.name} to ${destination.name} for ${transaction.formattedAmount}: <a href="https://opencollective.com/${user.slug}/transactions?searchTerm=%23${transaction.id}"><b>${transaction.description}</a></b>`
    };

// Skip comments as they have no usable data currently
} else if (data.type == "expense.comment.created") {
    result = {empty: true};

} else {
    const stringified = JSON.stringify(data, null, 2);
    result = {plain: stringified, html: `<pre><code class="language-json">${stringified}</code></pre>`};
};

result = {version: "v2", ...result};
