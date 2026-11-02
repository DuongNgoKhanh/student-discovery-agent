import threading

from agent_runtime.knowledge.index_runner import KnowledgeIndexRunner
from agent_runtime.knowledge.indexer import IndexReport, drain


class Service:
    def __init__(self, reports):
        self.reports = list(reports)
        self.calls = 0

    def run_once(self, batch_size):
        self.calls += 1
        return self.reports.pop(0) if self.reports else IndexReport()


def test_drain_pages_until_a_short_batch():
    service = Service([IndexReport(indexed=2), IndexReport(indexed=2), IndexReport(indexed=1)])
    assert drain(service, 2).indexed == 5
    assert service.calls == 3


def test_run_exits_when_the_queue_is_empty():
    passes = []
    runner = KnowledgeIndexRunner(lambda: passes.append(1) or IndexReport())
    assert runner.request() == "started"
    runner.join(2)
    assert passes == [1]
    assert not runner.running


def test_second_request_during_a_run_reruns_exactly_once():
    started, release = threading.Event(), threading.Event()
    passes = []

    def run_pass():
        passes.append(1)
        if len(passes) == 1:
            started.set()
            assert release.wait(2)
        return IndexReport(indexed=1) if len(passes) == 1 else IndexReport()

    runner = KnowledgeIndexRunner(run_pass)
    assert runner.request() == "started"
    assert started.wait(2)
    assert runner.request() == "already_running"
    assert runner.request() == "already_running"
    release.set()
    runner.join(2)
    # pass 1 (indexed work) -> pass 2 (empty) satisfies the rerun flag: no third pass
    assert len(passes) == 2
    assert runner.request() == "started"
    runner.join(2)


def test_rerun_flag_forces_one_more_pass_even_when_first_pass_is_empty():
    started, release = threading.Event(), threading.Event()
    passes = []

    def run_pass():
        passes.append(1)
        if len(passes) == 1:
            started.set()
            assert release.wait(2)
        return IndexReport()

    runner = KnowledgeIndexRunner(run_pass)
    runner.request()
    assert started.wait(2)
    assert runner.request() == "already_running"
    release.set()
    runner.join(2)
    assert len(passes) == 2


def test_never_two_threads_at_once_and_a_request_after_a_run_starts_a_new_one():
    active, peak, lock = 0, 0, threading.Lock()
    threads = set()

    def run_pass():
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            threads.add(threading.current_thread())
        threading.Event().wait(0.02)
        with lock:
            active -= 1
        return IndexReport()

    runner = KnowledgeIndexRunner(run_pass)
    barrier = threading.Barrier(8)
    results = []

    def hammer():
        barrier.wait()
        results.append(runner.request())

    callers = [threading.Thread(target=hammer) for _ in range(8)]
    for caller in callers:
        caller.start()
    for caller in callers:
        caller.join(2)
    runner.join(2)
    assert results.count("started") == 1 and peak == 1
    assert not runner.running
    assert runner.request() == "started"  # a request after a completed run starts a new thread
    runner.join(2)
    assert peak == 1 and len(threads) == 2


def test_a_thread_that_fails_to_start_does_not_wedge_the_runner(monkeypatch):
    runner = KnowledgeIndexRunner(lambda: IndexReport())
    real_start = threading.Thread.start
    calls = []

    def failing_start(self):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("can't start new thread")
        return real_start(self)

    monkeypatch.setattr(threading.Thread, "start", failing_start)
    try:
        runner.request()
    except RuntimeError:
        pass
    else:
        raise AssertionError("expected the start failure to surface")
    assert not runner.running
    assert runner.request() == "started"
    runner.join(2)


def test_an_exception_ends_the_run_and_a_later_run_works(caplog):
    outcomes = [RuntimeError("secret postgresql://u:p@h/db"), IndexReport()]
    passes = []

    def run_pass():
        passes.append(1)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    runner = KnowledgeIndexRunner(run_pass)
    assert runner.request() == "started"
    runner.join(2)
    assert not runner.running
    assert "secret" not in caplog.text and "postgresql" not in caplog.text
    assert "RuntimeError" in caplog.text
    assert runner.request() == "started"
    runner.join(2)
    assert len(passes) == 2
