-- CreateTable
CREATE TABLE "MLS_Webstore" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "app_user" TEXT NOT NULL,
    "app_pass" TEXT NOT NULL,

    CONSTRAINT "MLS_Webstore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDesk" (
    "id" SERIAL NOT NULL,
    "orderDeskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "shipStationId" TEXT NOT NULL,

    CONSTRAINT "OrderDesk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "exitCode" INTEGER,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MLS_Webstore_slug_key" ON "MLS_Webstore"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MLS_Webstore_sku_key" ON "MLS_Webstore"("sku");
