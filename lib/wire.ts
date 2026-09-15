/**
 * `RiverData` (lib/types.ts) uses real `Date` objects. Once it crosses the
 * `/api/river` JSON boundary, every `Date` becomes an ISO string via
 * `JSON.stringify`. This module reconstructs proper `Date` instances on the
 * client from that wire shape, rather than passing strings around and
 * re-parsing them ad hoc at each call site.
 */
import type {
  DataResult,
  FreshValue,
  RiverData,
  StageData,
  StageFlowPoint,
  VelocityData,
  VelocityForecast,
} from "./types";

type Iso = string | null;

type WireStageFlowPoint = Omit<StageFlowPoint, "time"> & { time: string };
type WireFreshValue<T> = Omit<FreshValue<T>, "observedAt"> & { observedAt: Iso };
type WireVelocityData = Omit<VelocityData, "latest" | "history"> & {
  latest: WireFreshValue<number> | null;
  history: { time: string; mph: number }[];
};
type WireStageData = Omit<
  StageData,
  "observed" | "forecast" | "forecastIssuedAt" | "floodStatus" | "latestFlow"
> & {
  observed: WireStageFlowPoint[];
  forecast: WireStageFlowPoint[];
  forecastIssuedAt: Iso;
  floodStatus: WireFreshValue<{ category: string }> | null;
  latestFlow: WireFreshValue<number> | null;
};

type WireVelocityForecast = Omit<VelocityForecast, "max" | "issuedAt"> & {
  max: { time: string; velocityMph: number } | null;
  issuedAt: Iso;
};

type WireTemperatureData = {
  latest: WireFreshValue<number> | null;
  history: { time: string; tempF: number }[];
};

export type RiverDataWire = {
  stage: DataResult<WireStageData>;
  velocity: DataResult<WireVelocityData>;
  temperature: DataResult<WireTemperatureData>;
  velocityForecast: DataResult<WireVelocityForecast>;
};

function reviveDate(iso: Iso): Date | null {
  return iso ? new Date(iso) : null;
}

function revivePoints(points: WireStageFlowPoint[]): StageFlowPoint[] {
  return points.map((p) => ({ ...p, time: new Date(p.time) }));
}

function reviveFreshValue<T>(value: WireFreshValue<T> | null): FreshValue<T> | null {
  if (!value) return null;
  return { ...value, observedAt: reviveDate(value.observedAt) };
}

export function reviveRiverData(wire: RiverDataWire): RiverData {
  const stage: DataResult<StageData> = wire.stage.ok
    ? {
        ok: true,
        fetchedAt: wire.stage.fetchedAt,
        data: {
          ...wire.stage.data,
          observed: revivePoints(wire.stage.data.observed),
          forecast: revivePoints(wire.stage.data.forecast),
          forecastIssuedAt: reviveDate(wire.stage.data.forecastIssuedAt),
          floodStatus: reviveFreshValue(wire.stage.data.floodStatus),
          latestFlow: reviveFreshValue(wire.stage.data.latestFlow),
        },
      }
    : wire.stage;

  const velocity: DataResult<VelocityData> = wire.velocity.ok
    ? {
        ok: true,
        fetchedAt: wire.velocity.fetchedAt,
        data: {
          latest: reviveFreshValue(wire.velocity.data.latest),
          history: wire.velocity.data.history.map((h) => ({ ...h, time: new Date(h.time) })),
        },
      }
    : wire.velocity;

  const temperature = wire.temperature.ok
    ? {
        ok: true as const,
        fetchedAt: wire.temperature.fetchedAt,
        data: {
          latest: reviveFreshValue(wire.temperature.data.latest),
          history: wire.temperature.data.history.map((h) => ({ ...h, time: new Date(h.time) })),
        },
      }
    : wire.temperature;

  const velocityForecast: DataResult<VelocityForecast> = wire.velocityForecast.ok
    ? {
        ok: true,
        fetchedAt: wire.velocityForecast.fetchedAt,
        data: {
          ...wire.velocityForecast.data,
          max: wire.velocityForecast.data.max
            ? { ...wire.velocityForecast.data.max, time: new Date(wire.velocityForecast.data.max.time) }
            : null,
          issuedAt: reviveDate(wire.velocityForecast.data.issuedAt),
        },
      }
    : wire.velocityForecast;

  return { stage, velocity, temperature, velocityForecast };
}
