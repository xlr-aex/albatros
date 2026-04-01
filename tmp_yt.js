const fs = require('fs')
const { XMLParser } = require('fast-xml-parser')

async function fetchYoutubeFeed() {
  const res = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvjELHjDqL0d1bw')
  const xml = await res.text()
  
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const parsed = parser.parse(xml)
  
  const entry = parsed.feed.entry[0]
  console.log(JSON.stringify(entry, null, 2))
}

fetchYoutubeFeed()
