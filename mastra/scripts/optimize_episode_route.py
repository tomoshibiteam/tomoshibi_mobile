#!/usr/bin/env python3
"""Optional OR-Tools route optimizer for TOMOSHIBI episode generation."""

import json
import sys
from typing import List


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def parse_input() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def sanitize_matrix(raw_matrix) -> List[List[int]]:
    if not isinstance(raw_matrix, list):
        return []
    matrix: List[List[int]] = []
    for row in raw_matrix:
        if not isinstance(row, list):
            return []
        sanitized_row: List[int] = []
        for value in row:
            try:
                num = int(float(value))
            except Exception:
                num = 0
            sanitized_row.append(max(0, num))
        matrix.append(sanitized_row)
    size = len(matrix)
    if size == 0:
        return []
    for row in matrix:
        if len(row) != size:
            return []
    return matrix


def main() -> None:
    payload = parse_input()
    matrix = sanitize_matrix(payload.get("distance_matrix"))
    if len(matrix) < 2:
        emit({"ok": False, "error": "invalid_distance_matrix"})
        return

    try:
        from ortools.constraint_solver import pywrapcp
        from ortools.constraint_solver import routing_enums_pb2
    except Exception:
        emit({"ok": False, "error": "ortools_not_installed"})
        return

    size = len(matrix)
    start_index = payload.get("start_index", 0)
    end_index = payload.get("end_index", size - 1)
    try:
        start_index = int(start_index)
        end_index = int(end_index)
    except Exception:
        start_index = 0
        end_index = size - 1
    if start_index < 0 or start_index >= size:
        start_index = 0
    if end_index < 0 or end_index >= size:
        end_index = size - 1

    manager = pywrapcp.RoutingIndexManager(size, 1, [start_index], [end_index])
    routing = pywrapcp.RoutingModel(manager)

    def transit_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(matrix[from_node][to_node])

    transit_index = routing.RegisterTransitCallback(transit_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_index)
    routing.AddDimension(transit_index, 0, 10000, True, "Time")
    routing.GetDimensionOrDie("Time").SetGlobalSpanCostCoefficient(100)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = 1

    solution = routing.SolveWithParameters(params)
    if solution is None:
        emit({"ok": False, "error": "ortools_no_solution"})
        return

    order: List[int] = []
    total_cost = 0
    index = routing.Start(0)
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        order.append(int(node))
        prev_index = index
        index = solution.Value(routing.NextVar(index))
        total_cost += routing.GetArcCostForVehicle(prev_index, index, 0)
    order.append(int(manager.IndexToNode(index)))

    emit(
        {
            "ok": True,
            "optimizer": "ortools_vrptw",
            "order": order,
            "total_cost": int(total_cost),
        }
    )


if __name__ == "__main__":
    main()
