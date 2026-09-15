## ধাপ ১: গোলাং বেসিক (যা জানা আবশ্যক)
### ১.১ ভেরিয়েবল ও ডেটা টাইপ

```go
package main

import "fmt"

func main() {
    // শর্টহ্যান্ড ডিক্লেয়ারেশন
    name := "গোলাং" 
    var version float64 = 1.23
    isActive := true

    fmt.Println(name, version, isActive)
}
```


### ১.২ অ্যারে, স্লাইস ও ম্যাপ (ডিপ লার্নিংয়ে ডেটা হ্যান্ডেলের জন্য জরুরি)

```go
// অ্যারে (ফিক্সড সাইজ)
var arr [3]int = [3]int{1, 2, 3}

// স্লাইস (ডায়নামিক অ্যারে) - ম্যাট্রিক্স ধারণের জন্য কাজে লাগে
matrix := [][]float64{
    {1.0, 2.0},
    {3.0, 4.0},
}

// ম্যাপ (কী-ভ্যালু) - হাইপারপ্যারামিটার সংরক্ষণে কাজে লাগে
config := map[string]int{
    "epochs": 100,
    "batch":  32,
}
```


### ১.৩ ফাংশন ও মাল্টিপল রিটার্ন (এরর হ্যান্ডেলিং-এর জন্য)

```go
func add(a, b float64) (float64, error) {
    if a < 0 || b < 0 {
        return 0, fmt.Errorf("negative value not allowed")
    }
    return a + b, nil
}
```


### ১.৪ স্ট্রাক্ট ও মেথড (নিউরাল নেটওয়ার্কের লেয়ার বানানোর জন্য)

```go
type Layer struct {
    Weights [][]float64
    Bias    []float64
}

// মেথড - ফরওয়ার্ড পাস
func (l *Layer) Forward(inputs []float64) []float64 {
    // ডট প্রোডাক্টের কাজ এখানে করবেন
    return outputs
}

```


### ১.৫ পয়েন্টার (পারফরম্যান্সের জন্য জরুরি)

```go
func updateWeights(w *[][]float64, lr float64) {
    // পয়েন্টার ব্যবহার করে আসল ওয়েট আপডেট হয়, কপি নয়
}
```

## ধাপ ২: অ্যাডভান্সড গোলাং (ডিপ লার্নিংয়ে কাজে লাগে)


### ২.১ কনকারেন্সি (গোরুটিন ও চ্যানেল) – প্যারালাল ব্যাচ প্রসেসিং

```go
func processBatch(data []float64, ch chan float64) {
    result := 0.0
    // কিছু ম্যাথ অপারেশন
    ch <- result
}

func main() {
    ch := make(chan float64)
    go processBatch(myData, ch) // প্যারালালে চলবে
    output := <-ch
}

```

### ২.২ ইন্টারফেস (যেকোনো অ্যাক্টিভেশন ফাংশন প্লাগ করবেন)

```go
type Activation interface {
    Forward(x float64) float64
    Derivative(x float64) float64
}

type Relu struct{}

func (r Relu) Forward(x float64) float64 {
    if x < 0 { return 0 }
    return x
}
```

### ২.৩ জেনেরিক্স (Go ১.১৮+) – টেনসর অপারেশন টাইপ-সেফ করতে

```go
func DotProduct[T float64 | int](a, b []T) T {
    var sum T
    for i := range a {
        sum += a[i] * b[i]
    }
    return sum
}

```

### ২.৪ এরর হ্যান্ডেলিং ও প্যানিক রিকভার (বড় মডেল ট্রেনিংয়ে ক্র্যাশ থেকে বাঁচায়)

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Println("রিকভার করা হয়েছে:", r)
    }
}()
```

## ধাপ ৩: ডিপ লার্নিংয়ের জন্য Go-তে যা যা লাগে

### ৩.১ নিজের হাতে ম্যাট্রিক্স গুণন (Matrix Multiplication) – নিউরাল নেটওয়ার্কের মূল কাজ

```go
func MatMul(a, b [][]float64) [][]float64 {
    rows, cols := len(a), len(b[0])
    result := make([][]float64, rows)
    for i := 0; i < rows; i++ {
        result[i] = make([]float64, cols)
        for j := 0; j < cols; j++ {
            for k := 0; k < len(b); k++ {
                result[i][j] += a[i][k] * b[k][j]
            }
        }
    }
    return result
}
```
> মন্তব্য: বাস্তবে এর জন্য gonum বা gorgonia লাইব্রেরি ব্যবহার করবেন, কারণ সেগুলো BLAS অপটিমাইজেশন ব্যবহার করে।

### ৩.২ গ্রেডিয়েন্ট ডিসেন্ট (SGD) – নিজে লিখে ফেলুন

```go
func SGD(weights [][]float64, gradients [][]float64, lr float64) {
    for i := range weights {
        for j := range weights[i] {
            weights[i][j] -= lr * gradients[i][j]
        }
    }
}
```

### ৩.৩ টেনসর ও অটোডিফ (AutoDiff) – গো-তে gorgonia লাইব্রেরি

`gorgonia` হলো Go-র TensorFlow। এতে কম্পিউটেশন গ্রাফ বানিয়ে অটোডিফ করা যায়।

```go
import "gorgonia.org/gorgonia"

func main() {
    g := gorgonia.NewGraph()
    x := gorgonia.NewMatrix(g, gorgonia.Float64, gorgonia.WithShape(2, 3), gorgonia.WithName("x"))
    w := gorgonia.NewMatrix(g, gorgonia.Float64, gorgonia.WithShape(3, 1), gorgonia.WithName("w"))
    y := gorgonia.Must(gorgonia.Mul(x, w))
    
    // এরপর গ্রেডিয়েন্ট বের করা ও ব্যাকপ্রোপাগেশন
}
```


### ৩.৪ ডেটা লোডিং ও প্রি-প্রসেসিং – CSV পার্সিং

```go
import "encoding/csv"

func loadCSV(filename string) [][]float64 {
    f, _ := os.Open(filename)
    r := csv.NewReader(f)
    records, _ := r.ReadAll()
    // ফ্লোট64-এ কনভার্ট করুন
}
```

### ৩.৫ মডেল সেভ ও লোড (gob বা JSON)

```go
import "encoding/gob"

func SaveModel(filename string, weights [][]float64) {
    file, _ := os.Create(filename)
    enc := gob.NewEncoder(file)
    enc.Encode(weights)
}
```


## ৪. বাংলায় একটি মিনি নিউরাল নেটওয়ার্কের স্ট্রাকচার (শুধু ফরওয়ার্ড)

```go
type NeuralNetwork struct {
    Layers []Layer
}

func (nn *NeuralNetwork) Predict(input []float64) []float64 {
    current := input
    for _, layer := range nn.Layers {
        current = layer.Forward(current) // ম্যাট্রিক্স গুণ + অ্যাক্টিভেশন
    }
    return current
}
```