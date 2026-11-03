# Stage F: learner overview

The home page, lesson map and profile now use authenticated learning data instead of decorative progress. Courses opens the existing database-backed lesson library.

## Behaviour

- `/learn` groups published lessons by course and chapter, shows chapter completion, best results, checkpoints, prerequisite suggestions and the recommended next lesson. Lessons remain accessible for independent study.
- Course preference is saved through the existing learning-plan API. The map refreshes after saving. Users can refresh progress manually.
- Home and profile show passed lessons, completed attempts, words encountered, review events, answer accuracy and elapsed attempt time. Existing gamification supplies actual XP and streaks.
- Recommendations reuse the adaptive learning planner: level, goal, selected course, prerequisite completion and mistakes. Skills display their evidence source and answer counts.
- Loading, empty, authentication and retry states are explicit. Account changes unmount private data; in-flight overview reads are cancelled.

## Statistics and access

Migration `20261103204130_learner_overview.sql` adds `learner_statistics`. It is restricted to `service_role`; `/api/overview` derives the user from the verified session and does not accept a user ID. Responses are not cached.

A passed lesson has a best score of at least 60%. Accuracy includes answers from repeat attempts. Time is elapsed time of completed attempts, including pauses, rather than active study time. Words are distinct normalized English/Russian pairs from passed lessons; encountering a word does not prove mastery. Due words follow the stage-E review schedule. Checkpoints include exercises of kind `unit_test`.

The migration was applied to the connected Supabase project. Application changes still require publishing to the Worker to appear on the live site.

## Verification

Unit and database tests cover chapter progress, saved course selection, prerequisites, empty accounts, aggregate calculations, user isolation and restricted database access. Browser tests cover a 320px map, actual lesson links, saved preferences, retry, logout and real home statistics. Browser API responses are fixtures; these tests do not claim live Telegram authentication coverage.
