package main

import "fmt"

func main() {
	// শর্টহ্যান্ড ডিক্লেয়ারেশন
	name := "গোলাং"
	var version float64 = 1.23
	isActive := true

	fmt.Println(name, version, isActive)

	var arr [3]int = [3]int{1, 2, 3}

	//স্লাইস (ডায়নামিক অ্যারে) - ম্যাট্রিক্স ধারণের জন্য কাজে লাগে
	matrix := [][]float64{
		{1.0, 2.0},
		{3.0, 4.0},
	}
	fmt.Println(arr, matrix)

	// ম্যাপ (কী-ভ্যালু) - হাইপারপ্যারামিটার সংরক্ষণে কাজে লাগে
	config := map[string]int{
		"epochs": 100,
		"batch":  32,
	}

	fmt.Println(config["epochs"])

}
