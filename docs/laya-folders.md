# Laya folders

Laya folders sort downloaded posts on your computer. Feed groups arrange feeds in the sidebar. Laya folders group posts by subject. Albatros checks each post against each applicable folder rule. A post can appear in more than one Laya folder.

## Create a folder

Open **Laya folders**. Enter a name and a main subject. You can add include and exclude terms to make the rule more precise. Use one clear subject for each folder.

## Select sources

Open **Périmètre** for the folder. Select the sources that Laya can check:

- Select a source group to include all its feeds.
- Select an individual feed to add it without its full group.
- You can use both types of selection.

Select **Enregistrer le périmètre** to save your changes. A folder with no selected sources has no posts to process.

## Check progress and control sorting

The top progress card shows all enabled Laya work. Each folder card shows progress for its selected sources. `processed / total` counts all completed decisions: include, exclude, and uncertain. It does not count only the posts assigned to the folder.

Select **Mettre en pause** to stop background work. This does not remove completed decisions. After you change a rule or its sources, select **Ré-analyser** to check that folder again. This action clears and repeats only that folder's decisions. If you delete a folder, Albatros removes its post memberships. It keeps the posts and the decisions for other folders.

## Local runtime

The first time you use Laya on Windows, Albatros downloads Python and the required Laya files into its application-data directory. It does not change the system Python installation. Later starts use the same files.

The first setup needs an internet connection and can take longer than later runs. The bundled runtime supports Windows only. If Laya does not start, read the worker error in the Laya view. Check your connection, restart Albatros, and try again.
