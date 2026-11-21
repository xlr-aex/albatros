# Laya folders

Laya folders organise downloaded posts with a local classifier. They are independent from feed groups: feed groups organise the sidebar, while Laya folders are subject-based collections. Each selected folder evaluates a post independently, so one post can appear in multiple folders.

## Create a folder

Open **Laya folders** and enter a title and main subject. The optional include and exclude fields refine the classifier’s rule. Keep rules specific and concise; one subject per folder is easier to maintain than a broad mixed rule.

## Choose a source scope

Open **Périmètre** on a folder to select where it may classify posts:

- A selected source group includes every feed in that group.
- Individual sources can be added without selecting their whole group.
- Both selections are combined.

Changes only take effect after **Enregistrer le périmètre**. A folder with no selected sources has no posts to process.

## Read progress and control sorting

The progress card at the top shows all enabled Laya evaluations. Each folder card has a separate bar for its own selected sources. `processed / total` includes include, exclude and uncertain decisions, so it represents completed classification work rather than only posts assigned to that card.

Use **Mettre en pause** to stop background work without losing decisions. **Ré-analyser** clears and re-evaluates only the selected folder’s decisions for its sources; use it after changing its rule or source scope. Deleting a folder deletes only its memberships, not the underlying posts or decisions in other folders.

## Local runtime

On its first Windows use, Albatros downloads an embedded Python runtime and the Laya dependencies into the application-data directory. This is private to Albatros and does not alter a system Python installation. Subsequent launches reuse it.

The first setup needs an internet connection and can take longer than later classifications. The bundled runtime is currently Windows-only. If startup fails, the Laya view displays the worker error; check the connection and restart Albatros before retrying.
