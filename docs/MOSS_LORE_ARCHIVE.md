# MOSS World Lore Archive

`server/data/moss_lore.json` is the local knowledge corpus used by the MOSS prototype for fictional *The Wandering Earth* world-building conversations.

## Scope

- Coverage: the film-world threads around the Wandering Earth plan, alternative plans, planetary engines, underground cities, lunar crisis, Jupiter crisis, Navigator Station, the 550 series, digital life, and major related characters.
- Representation: concise paraphrased archive notes. It deliberately does not contain dialogue, screenplay excerpts, complete plot transcripts, or claims that interface numbers are official canon.
- Boundary: every lore answer is marked as fictional-world information. It must not be used as real emergency, engineering, or system-control guidance.

## Record format

Each record has an archive ID, era, category, tags, a short event summary, a decision note, an outcome, and a `canon` marker:

- `FILM_1` / `FILM_2` / `FILM_UNIVERSE`: film-world summary.
- `PROJECT_POLICY`: a safety rule for this prototype, not a film claim.
- `PROJECT_INFERENCE`: a UI or world-building inference, not a fixed official number.

## Query examples

- `MOSS 有哪些记忆？`
- `月球危机是怎么回事？`
- `数字生命和图恒宇的档案`
- `木星危机的处置方案`
- `领航员空间站的作用`

The lookup layer is implemented in `server/agent/mossLore.js`; the model receives an indexed lore summary, while local fallback answers can retrieve a matching record even when a model is offline.
