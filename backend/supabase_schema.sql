-- Supabase Migration: Data Pipeline for FloodNav (Feature 4)

-- 1. Radar Snapshots Table
-- Stores the latest RainViewer path or timestamp every 10 minutes.
CREATE TABLE IF NOT EXISTS radar_snapshots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp timestamptz NOT NULL,
  rainviewer_path text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2. Water Level Logs Table
-- Stores the telemetry data from ThaiWater APIs every 10 minutes.
CREATE TABLE IF NOT EXISTS water_level_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id text NOT NULL,
  province text NOT NULL,
  water_level float NOT NULL,
  situation_level int NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 3. Flood Events Table
-- Logs any Early Warning alerts triggered by the system.
CREATE TABLE IF NOT EXISTS flood_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  province text NOT NULL,
  alert_level text NOT NULL,
  message text NOT NULL,
  triggered_at timestamptz DEFAULT now()
);

-- Note: Ensure uuid-ossp extension is enabled:
-- create extension if not exists "uuid-ossp";
