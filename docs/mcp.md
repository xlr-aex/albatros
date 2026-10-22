# MCP local Albatros

Albatros expose un serveur MCP local au démarrage : `http://127.0.0.1:8765/mcp`.
Il est accessible uniquement depuis cet ordinateur et nécessite un jeton Bearer.
Le jeton est affiché une fois dans le terminal d'Albatros au lancement. Vous pouvez
le fixer avant de lancer l'application avec `ALBATROS_MCP_TOKEN` (24 caractères ou
plus) pour utiliser une valeur connue.

## Antigravity

Dans `%USERPROFILE%\.gemini\config\mcp_config.json` (global) ou
`.agents\mcp_config.json` (projet) :

```json
{
  "mcpServers": {
    "albatros": {
      "serverUrl": "http://127.0.0.1:8765/mcp",
      "headers": {
        "Authorization": "Bearer VOTRE_JETON_ALBATROS"
      }
    }
  }
}
```

## OpenCode

Dans `opencode.json` :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "albatros": {
      "type": "remote",
      "url": "http://127.0.0.1:8765/mcp",
      "headers": {
        "Authorization": "Bearer VOTRE_JETON_ALBATROS"
      }
    }
  }
}
```

## ChatGPT

N'exposez jamais ce port sur Internet. Créez un Secure MCP Tunnel OpenAI vers
`http://127.0.0.1:8765/mcp`, configurez le même en-tête `Authorization`, puis
ajoutez l'URL du tunnel comme connecteur MCP dans ChatGPT.

Les outils de recherche sont en lecture seule. Les outils qui créent, modifient,
mettent en pause ou relancent un dossier Laya sont explicitement séparés.

## Recherche efficace pour les agents

`search_posts` accepte désormais une question complète. Albatros en extrait les
termes utiles, les cherche en mode tolérant, puis utilise un repli si l’index
plein texte ne retourne rien. Ne forcez donc pas l’agent à découper une question
en mots-clés un par un.

Exemples de demandes utiles à l’agent :

```text
Utilise technology_radar sur les 30 derniers jours. Analyse uniquement les
avancées techniques citées, sans rechercher des mots relatifs aux revenus, puis
classe les opportunités par potentiel produit en citant les posts concernés.

Liste les flux du groupe AI, puis cherche les annonces récentes concernant les
LLM locaux, avec le contenu des posts et les sources exactes.

Utilise get_recent_posts pour les groupes News et OSINT depuis le 2026-10-16,
puis construis une chronologie en distinguant les faits confirmés des analyses.
```

Outils de recherche :

- `list_source_groups`, `list_feeds` : découverte précise des groupes et flux.
- `search_posts` : requête naturelle, filtres `groupIds`, `feedIds`, `since`,
  `until`, et contenu optionnel.
- `get_recent_posts` : veille large sans mot-clé.
- `get_post_details` : vérification des faits et contexte avant citation.
- `technology_radar` : regroupement local des signaux techniques récents, sans
  biais vers des termes financiers.
