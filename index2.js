// Anime Hub - addon para Nuvio TV (protocolo Stremio). Fuentes: Kitsu + AniList
// Requiere Node 18+  ->  npm install && npm start
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const KITSU = "https://kitsu.io/api/edge";
const PAGE = 20;

// Géneros en español -> categoría de Kitsu
const GENEROS = {
  Acción: "action",
  "Artes Marciales": "martial-arts",
  Aventura: "adventure",
  "Ciencia Ficción": "science-fiction",
  Comedia: "comedy",
  Deportes: "sports",
  Detectives: "detective",
  Drama: "drama",
  Ecchi: "ecchi",
  Escolar: "school",
  Espacio: "space",
  Fantasía: "fantasy",
  Gore: "gore",
  Harem: "harem",
  Histórico: "historical",
  Horror: "horror",
  Isekai: "isekai",
  Josei: "josei",
  Juegos: "game",
  "Mahou Shoujo": "magical-girl",
  Mecha: "mecha",
  Militar: "military",
  Misterio: "mystery",
  Mitológico: "mythology",
  Música: "music",
  Parodia: "parody",
  Psicológico: "psychological",
  "Recuentos de la vida": "slice-of-life",
  Romance: "romance",
  Samuráis: "samurai",
  Seinen: "seinen",
  Shoujo: "shoujo",
  "Shoujo Ai": "shoujo-ai",
  Shounen: "shounen",
  "Shounen Ai": "shounen-ai",
  Sobrenatural: "supernatural",
  "Súper Poderes": "super-power",
  Suspenso: "thriller",
  Vampiros: "vampire",
};

const AÑOS = Array.from({ length: 2026 - 1990 + 1 }, (_, i) => String(2026 - i));

// Catálogos simples (Tipo y Estado)
const CATALOGOS = {
  "anime-recientes": { "filter[status]": "current", sort: "-startDate" },
  "anime-emision": { "filter[status]": "current", sort: "popularityRank" },
  "anime-estrenos": { "filter[status]": "upcoming", sort: "-userCount" },
  "anime-populares": { sort: "popularityRank" },
  "anime-finalizados": { "filter[status]": "finished", sort: "popularityRank" },
  "anime-peliculas": { "filter[subtype]": "movie", sort: "popularityRank" },
  "anime-ovas": { "filter[subtype]": "OVA", sort: "popularityRank" },
};

const skipExtra = [{ name: "skip" }];

const manifest = {
  id: "community.anime.kitsu.es",
  version: "2.0.0",
  name: "Anime Hub",
  description: "Episodios recientes, estrenos, géneros y filtros de anime",
  resources: ["catalog", "meta"],
  types: ["series"],
  idPrefixes: ["kitsu"],
  catalogs: [
    { type: "series", id: "anime-nuevos-episodios", name: "Episodios Recientes", extra: skipExtra },
    { type: "series", id: "anime-recientes", name: "Animes Recientes", extra: skipExtra },
    { type: "series", id: "anime-emision", name: "En emisión", extra: skipExtra },
    { type: "series", id: "anime-estrenos", name: "Próximos estrenos", extra: skipExtra },
    { type: "series", id: "anime-populares", name: "Populares", extra: skipExtra },
    { type: "series", id: "anime-finalizados", name: "Finalizados", extra: skipExtra },
    { type: "series", id: "anime-peliculas", name: "Películas", extra: skipExtra },
    { type: "series", id: "anime-ovas", name: "OVAs", extra: skipExtra },
    {
      type: "series",
      id: "anime-anio",
      name: "Por año",
      extra: [{ name: "genre", options: AÑOS, isRequired: true }, ...skipExtra],
    },
    {
      type: "series",
      id: "anime-generos",
      name: "Géneros",
      extra: [{ name: "genre", options: Object.keys(GENEROS), isRequired: true }, ...skipExtra],
    },
  ],
};

const builder = new addonBuilder(manifest);

async function kitsu(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${KITSU}${path}?${qs}`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!res.ok) throw new Error(`Kitsu ${res.status}`);
  return res.json();
}

function toMeta(item) {
  const a = item.attributes;
  return {
    id: `kitsu:${item.id}`,
    type: "series",
    name: a.titles?.es || a.titles?.en || a.titles?.en_jp || a.canonicalTitle,
    poster: a.posterImage?.large || a.posterImage?.medium,
    background: a.coverImage?.large || a.coverImage?.original,
    description: a.synopsis,
    releaseInfo: a.startDate ? a.startDate.slice(0, 4) : undefined,
    imdbRating: a.averageRating ? (Number(a.averageRating) / 10).toFixed(1) : undefined,
  };
}

// ---- Episodios Recientes (últimos 7 días, AniList -> ID de Kitsu) ----
const ANILIST_QUERY = `
query ($from: Int, $to: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) {
      episode
      airingAt
      media { idMal isAdult }
    }
  }
}`;

const kitsuByMal = new Map();
let semanaCache = { at: 0, metas: [] };

async function anilistPage(page, from, to) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { from, to, page } }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  return json.data.Page.airingSchedules;
}

async function malAKitsu(malId) {
  if (kitsuByMal.has(malId)) return kitsuByMal.get(malId);
  try {
    const data = await kitsu("/mappings", {
      "filter[externalSite]": "myanimelist/anime",
      "filter[externalId]": String(malId),
      include: "item",
    });
    const item = data.included?.[0] || null;
    kitsuByMal.set(malId, item);
    return item;
  } catch (e) {
    return null;
  }
}

async function nuevosEpisodios() {
  if (Date.now() - semanaCache.at < 30 * 60 * 1000 && semanaCache.metas.length) {
    return semanaCache.metas;
  }
  const now = Math.floor(Date.now() / 1000);
  const from = now - 7 * 24 * 3600;
  const pages = await Promise.all([1, 2].map((p) => anilistPage(p, from, now).catch(() => [])));

  const porAnime = new Map();
  for (const s of pages.flat()) {
    const m = s.media;
    if (!m?.idMal || m.isAdult) continue;
    if (!porAnime.has(m.idMal)) porAnime.set(m.idMal, s.episode);
  }

  const entradas = [...porAnime.entries()].slice(0, 60);
  const metas = [];
  for (let i = 0; i < entradas.length; i += 10) {
    const lote = await Promise.all(
      entradas.slice(i, i + 10).map(async ([malId, ep]) => {
        const item = await malAKitsu(malId);
        return item ? { ...toMeta(item), releaseInfo: `Ep ${ep}` } : null;
      })
    );
    metas.push(...lote.filter(Boolean));
  }
  if (metas.length) semanaCache = { at: Date.now(), metas };
  return metas;
}

async function listar(params) {
  const data = await kitsu("/anime", params);
  return data.data.map(toMeta);
}

builder.defineCatalogHandler(async ({ id, extra }) => {
  const skip = Number(extra?.skip || 0);
  const base = { "page[limit]": PAGE, "page[offset]": skip };

  try {
    if (id === "anime-nuevos-episodios") {
      const todos = await nuevosEpisodios();
      return { metas: todos.slice(skip, skip + PAGE) };
    }

    if (CATALOGOS[id]) {
      return { metas: await listar({ ...base, ...CATALOGOS[id] }) };
    }

    if (id === "anime-anio") {
      if (!extra?.genre) return { metas: [] };
      return { metas: await listar({ ...base, "filter[year]": extra.genre, sort: "popularityRank" }) };
    }

    if (id === "anime-generos") {
      const slug = GENEROS[extra?.genre];
      if (!slug) return { metas: [] };
      let metas = await listar({ ...base, "filter[categories]": slug, sort: "popularityRank" }).catch(() => []);
      if (!metas.length) {
        metas = await listar({ ...base, "filter[genres]": slug, sort: "popularityRank" }).catch(() => []);
      }
      return { metas };
    }
  } catch (e) {
    console.error(e);
  }
  return { metas: [] };
});

builder.defineMetaHandler(async ({ id }) => {
  const kid = id.split(":")[1];
  try {
    const { data } = await kitsu(`/anime/${kid}`);
    const meta = toMeta(data);

    const pages = await Promise.all(
      [0, 20, 40, 60, 80].map((o) =>
        kitsu(`/anime/${kid}/episodes`, { "page[limit]": 20, "page[offset]": o, sort: "number" }).catch(() => ({ data: [] }))
      )
    );
    meta.videos = pages
      .flatMap((p) => p.data)
      .map((ep) => ({
        id: `kitsu:${kid}:${ep.attributes.number}`,
        title: ep.attributes.titles?.en_us || ep.attributes.canonicalTitle || `Episodio ${ep.attributes.number}`,
        season: 1,
        episode: ep.attributes.number,
        released: ep.attributes.airdate ? new Date(ep.attributes.airdate).toISOString() : undefined,
        thumbnail: ep.attributes.thumbnail?.original,
      }));
    return { meta };
  } catch (e) {
    console.error(e);
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
