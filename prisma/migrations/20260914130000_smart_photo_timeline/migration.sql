ALTER TABLE photos ADD COLUMN timeline JSONB NOT NULL DEFAULT '{}', ADD COLUMN "timelineVersion" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE photo_timeline_edits (id TEXT PRIMARY KEY, "photoId" TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE ON UPDATE CASCADE, "actorId" TEXT NOT NULL, before JSONB NOT NULL, after JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "photo_timeline_edits_photoId_createdAt_idx" ON photo_timeline_edits("photoId","createdAt");
ALTER TABLE photo_timeline_edits ENABLE ROW LEVEL SECURITY;
