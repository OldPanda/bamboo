package engine

import (
	"errors"
	"fmt"
)

// MaxProfileValues bounds distinct non-NULL values in an exact column profile.
const MaxProfileValues = 10000

// MaxPivotGroups bounds complete, exportable pivot results.
const MaxPivotGroups = 1000

// PivotSpec selects one group dimension and one SQL aggregate. COUNT counts rows
// and ignores Metric; the other supported operations are SUM, AVG, MIN and MAX.
type PivotSpec struct {
	Group     string `json:"group"`
	Operation string `json:"operation"`
	Metric    string `json:"metric"`
}

type aggregation struct {
	PivotSpec
	profile bool
}

// ProfileRequest derives value counts from the full source query, including its
// bound filter. Explicit SQL limits remain; preview pagination and sort do not.
func ProfileRequest(source Request, column string) Request {
	source.Offset, source.Sort = 0, ""
	source.aggregation = &aggregation{PivotSpec: PivotSpec{Group: column, Operation: "COUNT"}, profile: true}
	return source
}

// PivotRequest derives a bounded aggregate from the full source query. Callers
// must stream and reject the extra sentinel group before publishing a result.
func PivotRequest(source Request, spec PivotSpec) Request {
	source.Offset, source.Sort = 0, ""
	source.aggregation = &aggregation{PivotSpec: spec}
	return source
}

func (a *aggregation) query(source string, columns []Column) (string, error) {
	foundGroup, foundMetric := false, false
	for _, column := range columns {
		foundGroup = foundGroup || column.Name == a.Group
		foundMetric = foundMetric || column.Name == a.Metric
	}
	if !foundGroup {
		return "", errors.New("choose a group column from the successful query")
	}
	expression := "count(*)"
	label := "COUNT(*)"
	switch a.Operation {
	case "COUNT":
	case "SUM", "AVG", "MIN", "MAX":
		if !foundMetric {
			return "", errors.New("choose a metric column from the successful query")
		}
		expression = a.Operation + "(" + ident(a.Metric) + ")"
		label = a.Operation + "(" + a.Metric + ")"
	default:
		return "", errors.New("choose COUNT, SUM, AVG, MIN or MAX")
	}
	limit := MaxPivotGroups + 1
	if a.profile {
		// Allow the NULL group in addition to the exact-value limit and sentinel.
		limit = MaxProfileValues + 2
	}
	return "SELECT " + ident(a.Group) + ", " + expression + " AS " + ident(label) + " FROM (" + source + "\n) AS bamboo_analysis GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT " + fmt.Sprint(limit), nil
}
