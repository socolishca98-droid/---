-- CreateTable
CREATE TABLE "AtiScanConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'default',
    "cities" TEXT NOT NULL DEFAULT '[]',
    "radius" INTEGER NOT NULL DEFAULT 200,
    "truckTypes" TEXT NOT NULL DEFAULT 'any',
    "minWeight" INTEGER,
    "autoScanInterval" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastScanAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AtiCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "atiLoadId" TEXT NOT NULL,
    "routeFrom" TEXT NOT NULL,
    "routeFromId" TEXT,
    "routeTo" TEXT NOT NULL,
    "routeToId" TEXT,
    "distance" INTEGER,
    "weight" INTEGER,
    "volume" REAL,
    "cargoType" TEXT,
    "truckType" TEXT,
    "loadingType" TEXT,
    "price" INTEGER,
    "priceType" TEXT,
    "paymentType" TEXT,
    "vatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "loadingDate" DATETIME,
    "unloadingDate" DATETIME,
    "firmId" TEXT,
    "firmName" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "note" TEXT,
    "rawJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "aiScore" INTEGER,
    "aiReason" TEXT,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AtiSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "routeFrom" TEXT NOT NULL,
    "routeTo" TEXT NOT NULL,
    "distance" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "volume" REAL,
    "cargoType" TEXT NOT NULL,
    "loadingType" TEXT NOT NULL DEFAULT 'other',
    "requirements" TEXT,
    "price" INTEGER,
    "priceNegotiable" BOOLEAN NOT NULL DEFAULT false,
    "paymentType" TEXT,
    "vatType" TEXT,
    "deferredDays" INTEGER,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "dueDate" DATETIME,
    "clientName" TEXT,
    "clientContact" TEXT NOT NULL,
    "clientFirmId" TEXT,
    "deadline" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'needs_clarification',
    "aiScore" INTEGER NOT NULL DEFAULT 50,
    "aiReason" TEXT,
    "assignedDriverId" TEXT,
    "assignedVehicleId" TEXT,
    "routeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehicleType" TEXT NOT NULL,
    "vehiclePlate" TEXT NOT NULL,
    "currentLocation" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "lastGpsUpdate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'available',
    "ordersCompleted" INTEGER NOT NULL DEFAULT 0,
    "rating" REAL NOT NULL DEFAULT 5.0,
    "licenseNumber" TEXT,
    "licenseExpiry" DATETIME,
    "medicalExpiry" DATETIME,
    "hiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plate" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "capacity" INTEGER NOT NULL,
    "volume" REAL,
    "length" REAL,
    "width" REAL,
    "height" REAL,
    "features" TEXT NOT NULL DEFAULT '[]',
    "driverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "lastMaintenanceDate" DATETIME,
    "nextMaintenanceDate" DATETIME,
    "mileage" INTEGER,
    "insuranceExpiry" DATETIME,
    "inspectionExpiry" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DriverShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'driving',
    "totalDrivingSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalRestingSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalLoadingSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalWaitingSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastStatusChangeAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShiftEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "address" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "DriverShift" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SosAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "respondedBy" TEXT,
    "respondedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "driverId" TEXT,
    "orderId" TEXT,
    "photoId" TEXT,
    "sosId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AtiCache_atiLoadId_key" ON "AtiCache"("atiLoadId");

-- CreateIndex
CREATE INDEX "AtiCache_status_idx" ON "AtiCache"("status");

-- CreateIndex
CREATE INDEX "AtiCache_scannedAt_idx" ON "AtiCache"("scannedAt");

-- CreateIndex
CREATE INDEX "AtiCache_routeFrom_routeTo_idx" ON "AtiCache"("routeFrom", "routeTo");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_priority_idx" ON "Order"("priority");

-- CreateIndex
CREATE INDEX "Order_source_idx" ON "Order"("source");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "DriverShift_driverId_idx" ON "DriverShift"("driverId");

-- CreateIndex
CREATE INDEX "DriverShift_status_idx" ON "DriverShift"("status");

-- CreateIndex
CREATE INDEX "DriverShift_startedAt_idx" ON "DriverShift"("startedAt");

-- CreateIndex
CREATE INDEX "ShiftEvent_shiftId_idx" ON "ShiftEvent"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftEvent_type_idx" ON "ShiftEvent"("type");

-- CreateIndex
CREATE INDEX "SosAlert_driverId_idx" ON "SosAlert"("driverId");

-- CreateIndex
CREATE INDEX "SosAlert_status_idx" ON "SosAlert"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_priority_idx" ON "Notification"("priority");
