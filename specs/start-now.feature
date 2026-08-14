Feature: Start new goal immediately

  Scenario: Start now replaces active goal
    Given a pomodoro session is running for goal "Write tests"
    When the user adds a new goal "Fix bug" with "Start now" checked
    Then the session switches to goal "Fix bug"
    And the timer resets to 25 minutes

  Scenario: Start now is unchecked by default when a goal is active
    Given a pomodoro session is running for goal "Write tests"
    When the user opens the new goal dialog
    Then the "Start now" checkbox is unchecked

  Scenario: Start now is unchecked by default during a break
    Given a short or long break is in progress
    When the user opens the new goal dialog
    Then the "Start now" checkbox is unchecked

  Scenario: Start now is checked by default when idle
    Given the timer is idle
    When the user opens the new goal dialog
    Then the "Start now" checkbox is checked
