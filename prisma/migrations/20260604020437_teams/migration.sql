-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('owner', 'member');

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_code_key" ON "TeamInvite"("code");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
