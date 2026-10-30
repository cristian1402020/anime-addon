// Addon de anime para Nuvio TV (protocolo Stremio) usando la API de Kitsu
// Requiere Node 18+  ->  npm install && npm start
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const KITSU = "https://kitsu.io/api/edge";
const PAGE = 20;

const GENEROS = {
  Acción: "action",
  Aventura: "adventure",
  Comedia: "comedy",
  Drama: "drama",
  Fantasía: "fantasy",
  Terror: "horror",
  Misterio: "mystery",
  Romance: "romance",
  "Ciencia ficción": "sci-fi",
  "Slice of life": "slice-of-life",
  Deportes: "sports",
  Sobrenatural: "supernatural",
  Thriller: "thriller",
  Mecha: "mecha",
  Música: "music",
  Psicológico: "psychological",
};

const manifest = {
  id: "community.anime.kitsu.es",
  version: "1.0.0",
  name: "Anime Hub",
  description: "Nuevos episodios, estrenos y géneros de anime (Kitsu)",
  resources: ["catalog", "meta"],
  types: ["series"],
  idPrefixes: ["kitsu"],
  catalogs: [
    { type: "series", id: "anime-nuevos-episodios", name: "Anime · Nuevos episodios", extra: [{ name: "skip" }] },
    { type: "series", id: "anime-estrenos", name: "Anime · Próximos estrenos", extra: [{ name: "skip" }] },
    { type: "series", id: "anime-populares", name: "Anime · Populares", extra: [{ name: "skip" }] },
    {
      type: "series",
      id: "anime-generos",
      name: "Anime · Géneros",
      extra: [{ name: "genre", options: Object.keys(GENEROS), isRequired: true }, { name: "skip" }],
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

builder.defineCatalogHandler(async ({ id, extra }) => {
  const skip = Number(extra?.skip || 0);
  const base = { "page[limit]": PAGE, "page[offset]": skip };
  let params;

  switch (id) {
    case "anime-nuevos-episodios":
      // En emisión, ordenados por la última actualización (episodio nuevo)
      params = { ...base, "filter[status]": "current", sort: "-updatedAt" };
      break;
    case "anime-estrenos":
      params = { ...base, "filter[status]": "upcoming", sort: "-userCount" };
      break;
    case "anime-populares":
      params = { ...base, sort: "popularityRank" };
      break;
    case "anime-generos": {
      const slug = GENEROS[extra?.genre];
      if (!slug) return { metas: [] };
      params = { ...base, "filter[genres]": slug, sort: "popularityRank" };
      break;
    }
    default:
      return { metas: [] };
  }

  try {
    const data = await kitsu("/anime", params);
    return { metas: data.data.map(toMeta) };
  } catch (e) {
    console.error(e);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  const kid = id.split(":")[1];
  try {
    const { data } = await kitsu(`/anime/${kid}`);
    const meta = toMeta(data);

    // Episodios (hasta 100)
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
