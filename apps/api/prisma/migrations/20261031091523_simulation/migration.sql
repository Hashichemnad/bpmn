-- CreateEnum
CREATE TYPE "SimulationScenarioKind" AS ENUM ('AS_IS', 'TO_BE');


-- CreateTable
CREATE TABLE "Simulation" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "processId" UUID NOT NULL,
    "logId" UUID,
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationScenario" (
    "id" UUID NOT NULL,
    "simulationId" UUID NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameAr" TEXT NOT NULL DEFAULT '',
    "kind" "SimulationScenarioKind" NOT NULL DEFAULT 'TO_BE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "processVersion" INTEGER,
    "params" JSONB NOT NULL,
    "result" JSONB,
    "resultModel" TEXT,
    "ranAt" TIMESTAMP(3),
    "ranById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Simulation_processId_idx" ON "Simulation"("processId");

-- CreateIndex
CREATE INDEX "SimulationScenario_simulationId_idx" ON "SimulationScenario"("simulationId");

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationScenario" ADD CONSTRAINT "SimulationScenario_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
