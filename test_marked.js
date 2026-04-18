const { marked } = require('marked');
const html = marked.parse('Here is a link <a href="https://example.com" class="badge" target="_blank">[12]</a>', { async: false });
console.log(html);
