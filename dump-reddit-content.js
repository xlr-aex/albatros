const fs=require('fs');
const {XMLParser}=require('./node_modules/fast-xml-parser');
const p=new XMLParser();
const d=p.parse(fs.readFileSync('reddit.xml'));
const content = d.feed.entry[0].content;
fs.writeFileSync('reddit-content.txt', content);
