ALTER TABLE "ReportSchedule"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
  ADD COLUMN "scheduledHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "scheduledMinute" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scheduledWeekday" INTEGER,
  ADD COLUMN "scheduledMonthDay" INTEGER,
  ADD COLUMN "startAt" TIMESTAMP(3);
