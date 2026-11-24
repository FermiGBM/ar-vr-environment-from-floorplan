# Notebook cell sources

`cells/` holds the exact source of the code/markdown cells that `patch_notebook.py` injects into
`ar_vr_environment_kaggle.ipynb`. Edit the cell files, then run:

```bash
python notebook_src/patch_notebook.py
```

This keeps the large notebook JSON diffable and lets you rebuild it without hand-editing cells.
