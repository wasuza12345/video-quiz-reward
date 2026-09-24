// Plain factory wiring (no DI library — plan §2). One instance per process; repositories share
// the single `prisma` singleton, so this is cheap to construct more than once too.
import { createUserController } from "./modules/user/user.controller";
import { createUserRepository } from "./modules/user/user.repository";
import { createUserService } from "./modules/user/user.service";
import { createVideoController } from "./modules/video/video.controller";
import { createVideoRepository } from "./modules/video/video.repository";
import { createVideoService } from "./modules/video/video.service";
import { createQuizRepository } from "./modules/quiz/quiz.repository";
import { createWatchSessionController } from "./modules/watch-session/watch-session.controller";
import { createWatchSessionRepository } from "./modules/watch-session/watch-session.repository";
import { createWatchSessionService } from "./modules/watch-session/watch-session.service";
import { createRewardController } from "./modules/reward/reward.controller";
import { createRewardRepository } from "./modules/reward/reward.repository";
import { createRewardService } from "./modules/reward/reward.service";

export function createContainer() {
  const userRepo = createUserRepository();
  const videoRepo = createVideoRepository();
  const quizRepo = createQuizRepository();
  const sessionRepo = createWatchSessionRepository();
  const rewardRepo = createRewardRepository();

  const userService = createUserService({ rewardRepo });
  const videoService = createVideoService({ videoRepo, rewardRepo });
  const watchSessionService = createWatchSessionService({ sessionRepo, videoRepo, quizRepo, userRepo });
  const rewardService = createRewardService({ rewardRepo, sessionRepo, videoRepo });

  return {
    userController: createUserController({ userService }),
    videoController: createVideoController({ videoService }),
    watchSessionController: createWatchSessionController({ watchSessionService }),
    rewardController: createRewardController({ rewardService }),
  };
}

export type Container = ReturnType<typeof createContainer>;

let cached: Container | undefined;
/** Lazily built, process-wide singleton — route handlers call this instead of re-wiring per request. */
export function getContainer(): Container {
  return (cached ??= createContainer());
}
