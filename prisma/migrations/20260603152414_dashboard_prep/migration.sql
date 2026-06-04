-- DropForeignKey
ALTER TABLE "InviteCode" DROP CONSTRAINT "InviteCode_createdById_fkey";

-- DropForeignKey
ALTER TABLE "InviteCode" DROP CONSTRAINT "InviteCode_usedById_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "githubId" TEXT;

-- DropTable
DROP TABLE "InviteCode";

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");
